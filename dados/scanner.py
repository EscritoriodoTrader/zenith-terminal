import xlwings as xw
import time
import requests
import datetime
import threading
import queue
import websocket
import json

# ==========================================
# CONFIGURAÇÕES DO SISTEMA
# ==========================================
EXCEL_FILE_NAME = "Fluxo.xlsm"
SHEET_NAME = "Dados_RTD"
SERVER_HOST = "zenith-terminal-bvj4.onrender.com"
POST_URL = f"https://{SERVER_HOST}/api/trades"
SCAN_INTERVAL = 0.005 

# Fila de transmissão e Sincronização
tx_queue = queue.Queue()
session = requests.Session()
is_active = False # Controle de Standby

def on_message(ws, message):
    global is_active
    try:
        data = json.loads(message)
        if data.get('type') == 'MOTOR_STATUS':
            is_active = data.get('running', False)
            status_str = "ATIVO" if is_active else "STANDBY"
            print(f"[STATUS]: Motor {status_str}")
    except: pass

def start_ws():
    """Conecta ao servidor para ouvir o comando de Ligar/Desligar"""
    def run():
        while True:
            try:
                ws_url = f"wss://{SERVER_HOST}"
                ws = websocket.WebSocketApp(ws_url, on_message=on_message)
                ws.run_forever()
            except: pass
            time.sleep(5)
    threading.Thread(target=run, daemon=True).start()

# Inicia o ouvinte de status em background
start_ws()

def tx_worker():
    """Worker para enviar dados ao servidor Node.js sem travar a leitura do Excel"""
    print("[TX]: Canal de transmissão iniciado.")
    while True:
        try:
            payload = tx_queue.get()
            if payload is None: break
            try:
                session.post(POST_URL, json=payload, timeout=0.5)
            except: pass
            tx_queue.task_done()
        except: pass

def clear_database():
    """Envia um comando para limpar o banco de dados no início da sessão"""
    try:
        print("[INIT]: Solicitando limpeza do banco de dados para nova sessão...")
        requests.delete(f"https://{SERVER_HOST}/api/trades/clear", timeout=5)
        print("[INIT]: Banco de dados resetado com sucesso.")
    except Exception as e:
        print(f"[INIT ERROR]: Falha ao resetar banco: {e}")

def get_excel_app():
    """Busca o Excel aberto e a aba correta"""
    try:
        if len(xw.apps) == 0: return None
        for app in xw.apps:
            for book in app.books:
                if EXCEL_FILE_NAME in book.name:
                    return book.sheets[SHEET_NAME]
        return None
    except: return None

def process_time(val, now):
    """Converte o valor de tempo do Excel para Timestamp MS"""
    try:
        if isinstance(val, (float, int)):
            seconds = int(val * 86400)
            h, m, s = (seconds // 3600) % 24, (seconds // 60) % 60, seconds % 60
        else:
            parts = str(val).split(':')
            h = int(parts[0])
            m = int(parts[1])
            s = int(parts[2].split('.')[0]) if len(parts) > 2 else 0
        
        dt = now.replace(hour=h, minute=m, second=s, microsecond=0)
        if dt > now + datetime.timedelta(minutes=1): dt -= datetime.timedelta(days=1)
        return int(dt.timestamp() * 1000), f"{h:02d}:{m:02d}:{s:02d}"
    except: return None, None

def main():
    print("--- ZENITH SCANNER V5.1: STANDBY MODE ---")
    
    # Inicia Thread de Envio
    threading.Thread(target=tx_worker, daemon=True).start()
    
    # Limpa o banco de dados antes de começar
    clear_database()
    
    sheet = None
    sent_trades_buffer = set()
    last_price_sent = 0
    last_variation_sent = -999
    
    while True:
        try:
            # MODO STANDBY: Só trabalha se o motor estiver ON no gráfico
            if not is_active:
                time.sleep(1)
                continue

            if not sheet:
                sheet = get_excel_app()
                if not sheet:
                    time.sleep(2)
                    continue
                print("Conectado ao Excel. Iniciando leitura...")

            # Leitura do bloco de dados
            data = sheet.range("A2:J507").value
            if not data or not data[0]:
                time.sleep(0.1)
                continue

            current_price = data[0][2] or 0
            current_variation = data[0][7] or 0
            trade_rows = data[6:]
            now = datetime.datetime.now()
            new_trades = []
            counters = {}

            for row in trade_rows:
                # COMPRA
                if row[0] and row[1] and row[2]:
                    ts, time_str = process_time(row[0], now)
                    if ts:
                        price, qty = float(row[1]), int(row[2])
                        sig = f"BUY_{time_str}_{price}_{qty}"
                        counters[sig] = counters.get(sig, 0) + 1
                        uid = f"{sig}_{counters[sig]}"
                        if uid not in sent_trades_buffer:
                            new_trades.append({"id": uid, "timestamp": ts, "price": price, "quantity": qty, "side": "BUY"})
                            sent_trades_buffer.add(uid)
                # VENDA
                if row[6] and row[7] and row[8]:
                    ts, time_str = process_time(row[6], now)
                    if ts:
                        price, qty = float(row[7]), int(row[8])
                        sig = f"SELL_{time_str}_{price}_{qty}"
                        counters[sig] = counters.get(sig, 0) + 1
                        uid = f"{sig}_{counters[sig]}"
                        if uid not in sent_trades_buffer:
                            new_trades.append({"id": uid, "timestamp": ts, "price": price, "quantity": qty, "side": "SELL"})
                            sent_trades_buffer.add(uid)

            if len(sent_trades_buffer) > 15000:
                sent_trades_buffer = set(list(sent_trades_buffer)[-5000:])

            p_changed = abs(current_price - last_price_sent) > 0.0001
            v_changed = abs(current_variation - last_variation_sent) > 0.0001
            
            if new_trades or p_changed or v_changed:
                if new_trades: new_trades.sort(key=lambda x: x['timestamp'])
                tx_queue.put({"trades": new_trades, "last_price": current_price, "variation": current_variation})
                last_price_sent, last_variation_sent = current_price, current_variation

            time.sleep(SCAN_INTERVAL)
        except Exception as e:
            print(f"[LOOP ERROR]: {e}")
            sheet = None
            time.sleep(1)

if __name__ == "__main__":
    main()
