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
SHEET_RTD = "Dados_RTD"
SHEET_HISTORICO = "Historico"
SERVER_HOST = "zenith-terminal-bvj4.onrender.com"
POST_URL = f"https://{SERVER_HOST}/api/trades"
SCAN_INTERVAL = 0.005 

# Fila de transmissão e Sincronização
tx_queue = queue.Queue()
session = requests.Session()
is_active = False 
last_historical_ts = 0 

ws_client = None

def on_message(ws, message):
    global is_active, ws_client
    ws_client = ws
    try:
        msg = json.loads(message)
        if msg.get('type') == 'MOTOR_STATUS':
            is_active = msg.get('running', False)
    except: pass

def start_ws():
    def run():
        global ws_client
        print(f"[WS]: Iniciando conexão com o servidor em {SERVER_HOST}...")
        while True:
            try:
                ws_url = f"wss://{SERVER_HOST}"
                ws = websocket.WebSocketApp(ws_url, on_message=on_message)
                print(f"[WS]: Túnel de dados aberto.")
                ws.run_forever()
            except Exception as e:
                print(f"[WS]: Erro na conexão: {e}")
            time.sleep(5)
    threading.Thread(target=run, daemon=True).start()

start_ws()

def tx_worker():
    print("[TX]: Canal de transmissão iniciado.")
    while True:
        try:
            payload = tx_queue.get()
            if payload is None: break
            
            # TENTA ENVIAR VIA WEBSOCKET (MUITO MAIS RÁPIDO)
            sent_ws = False
            if ws_client and ws_client.sock and ws_client.sock.connected:
                try:
                    ws_client.send(json.dumps({
                        "type": "NEW_TRADES",
                        "data": payload.get("trades", []),
                        "last_price": payload.get("last_price")
                    }))
                    sent_ws = True
                except: pass
            
            # SE O WS FALHAR, USA O HTTP COMO BACKUP
            if not sent_ws:
                try:
                    session.post(POST_URL, json=payload, timeout=3)
                except: pass
                
            tx_queue.task_done()
        except: pass

def clear_database():
    try:
        print("[INIT]: Solicitando limpeza do banco de dados para nova sessão...")
        requests.delete(f"https://{SERVER_HOST}/api/trades/clear", timeout=5)
        print("[INIT]: Banco de dados resetado com sucesso.")
    except Exception as e:
        print(f"[INIT ERROR]: Falha ao resetar banco: {e}")

def get_sheet(name):
    try:
        if len(xw.apps) == 0: return None
        for app in xw.apps:
            for book in app.books:
                if EXCEL_FILE_NAME in book.name:
                    return book.sheets[name]
        return None
    except: return None

def process_time(val, now):
    try:
        ms = 0
        if isinstance(val, datetime.datetime):
            h, m, s, ms = val.hour, val.minute, val.second, val.microsecond // 1000
        elif isinstance(val, (float, int)):
            seconds = int(val * 86400)
            h, m, s = (seconds // 3600) % 24, (seconds // 60) % 60, seconds % 60
        else:
            v_str = str(val).replace(',', '.')
            time_part = v_str.split(' ')[-1] if ' ' in v_str else v_str
            # Trata Milissegundos
            if '.' in time_part:
                time_part, ms_str = time_part.split('.')
                ms = int(ms_str[:3].ljust(3, '0'))
            
            p = time_part.split(':')
            h, m, s = int(p[0]), int(p[1]), int(p[2])

        dt = now.replace(hour=h, minute=m, second=s, microsecond=ms * 1000)
        if dt > now + datetime.timedelta(hours=4): dt -= datetime.timedelta(days=1)
        return int(dt.timestamp() * 1000), dt.strftime('%H:%M:%S')
    except: return None, None

def clean_price(val):
    try:
        if isinstance(val, (float, int)): 
            n = float(val)
        else:
            s = str(val).strip().replace(' ', '')
            if ',' in s and '.' in s: s = s.replace('.', '').replace(',', '.')
            elif ',' in s: s = s.replace(',', '.')
            n = float(s)
        
        # AJUSTE NASDAC: Se o número vier como 278375 (sem ponto), 
        # ele vira 27837.5 automaticamente.
        if n > 100000: n = n / 10.0
        return n
    except: return 0.0

def read_historical_data(sent_buffer):
    """Lê a aba Histórico para carregar o passado"""
    global last_historical_ts
    sheet_h = get_sheet("Historico")
    if not sheet_h: return
    
    last_row = sheet_h.range("A" + str(sheet_h.cells.last_cell.row)).end('up').row
    if last_row < 2: return

    print(f"[HISTORICO]: Lendo {last_row - 1} trades passados...")
    data = sheet_h.range(f"A2:F{last_row}").value # A=Hora, C=Preço, D=Qtd, F=Agressor
    if not isinstance(data[0], list): data = [data]

    now = datetime.datetime.now()
    hist_trades = []
    for row in data:
        if not row or len(row) < 6: continue
        ts, time_str = process_time(row[0], now)
        if ts:
            try:
                price = clean_price(row[2])
                qty = int(row[3]) if row[3] else 0
                side = "BUY" if "COMPR" in str(row[5]).upper() else "SELL"
                
                uid = f"HIST_{ts}_{price}_{qty}_{side}"
                if uid not in sent_buffer:
                    hist_trades.append({"id": uid, "timestamp": ts, "price": price, "quantity": qty, "side": side})
                    sent_buffer.add(uid)
                    if ts > last_historical_ts: last_historical_ts = ts
            except: continue

    if hist_trades:
        hist_trades.sort(key=lambda x: x['timestamp'])
        print(f"[HISTORICO]: Enviando {len(hist_trades)} trades históricos.")
        tx_queue.put({"trades": hist_trades, "last_price": hist_trades[-1]['price'], "variation": 0})

def main():
    global last_historical_ts
    print("--- ZENITH SCANNER V5.3: DYNAMIC HISTORICO ---")
    threading.Thread(target=tx_worker, daemon=True).start()
    clear_database()
    
    sheet_rtd = None
    sent_trades_buffer = set()
    last_price_sent = 0
    last_variation_sent = -999
    historical_loaded = False
    
    last_wait_log = 0
    while True:
        try:
            if not is_active:
                if time.time() - last_wait_log > 10:
                    print("[STATUS]: Aguardando o motor ser ligado no gráfico...")
                    last_wait_log = time.time()
                
                if historical_loaded: # Se estava ligado e agora desligou
                    print("[STATUS]: Motor em STANDBY. Limpando memória local...")
                    sent_trades_buffer.clear()
                    historical_loaded = False
                time.sleep(1)
                continue

            if not historical_loaded:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Motor Ligado! Resetando e carregando histórico...")
                clear_database()
                read_historical_data(sent_trades_buffer)
                historical_loaded = True

            if not sheet_rtd:
                sheet_rtd = get_sheet("Dados_RTD")
                if not sheet_rtd:
                    time.sleep(2)
                    continue
                print("[RTD]: Conectado à aba Dados_RTD.")

            # Leitura do Tempo Real (Duas Tabelas: Compra A-D | Venda G-J)
            data = sheet_rtd.range("A8:J500").value
            if not data or not data[0]:
                time.sleep(0.1)
                continue

            # Preço atual pegamos da célula C2 (como solicitado)
            try:
                current_price = clean_price(sheet_rtd.range("C2").value)
            except:
                current_price = 0
            
            now = datetime.datetime.now()
            new_trades = []
            counters = {}

            for row in data:
                # 1. PROCESSA BLOCO COMPRA (A, B, C, D)
                if row[0] and row[1] and row[2]:
                    ts, time_str = process_time(row[0], now)
                    if ts and ts >= last_historical_ts:
                        try:
                            p = clean_price(row[1])
                            q = int(row[2])
                            sig = f"BUY_{ts}_{p}_{q}"
                            counters[sig] = counters.get(sig, 0) + 1
                            uid = f"{sig}_{counters[sig]}"
                            if uid not in sent_trades_buffer:
                                new_trades.append({"id": uid, "timestamp": ts, "price": p, "quantity": q, "side": "BUY"})
                                sent_trades_buffer.add(uid)
                        except: pass

                # 2. PROCESSA BLOCO VENDA (G, H, I, J)
                if row[6] and row[7] and row[8]:
                    ts, time_str = process_time(row[6], now)
                    if ts and ts >= last_historical_ts:
                        try:
                            p = clean_price(row[7])
                            q = int(row[8])
                            sig = f"SELL_{ts}_{p}_{q}"
                            counters[sig] = counters.get(sig, 0) + 1
                            uid = f"{sig}_{counters[sig]}"
                            if uid not in sent_trades_buffer:
                                new_trades.append({"id": uid, "timestamp": ts, "price": p, "quantity": q, "side": "SELL"})
                                sent_trades_buffer.add(uid)
                        except: pass

            if len(sent_trades_buffer) > 40000:
                sent_trades_buffer = set(list(sent_trades_buffer)[-20000:])

            if new_trades:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] >>> ENVIANDO {len(new_trades)} TRADES | EX: {new_trades[0]['timestamp']} <<<")
                new_trades.sort(key=lambda x: x['timestamp'])
                tx_queue.put({"trades": new_trades, "last_price": current_price, "variation": 0})
                last_price_sent = current_price
            else:
                if time.time() - last_wait_log > 2:
                    status_motor = "LIGADO" if is_active else "STANDBY"
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [VIVO] Motor: {status_motor} | Lendo aba Dados_RTD...")
                    last_wait_log = time.time()

            time.sleep(SCAN_INTERVAL)
        except Exception as e:
            print(f"[RTD ERROR]: {e}")
            sheet_rtd = None
            time.sleep(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n👋 Sistema finalizado pelo usuário. Até logo!")
