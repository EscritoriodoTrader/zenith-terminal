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
    def run():
        while True:
            try:
                ws_url = f"wss://{SERVER_HOST}"
                ws = websocket.WebSocketApp(ws_url, on_message=on_message)
                ws.run_forever()
            except: pass
            time.sleep(5)
    threading.Thread(target=run, daemon=True).start()

start_ws()

def tx_worker():
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
        # Pega apenas a Hora, Minuto e Segundo, ignorando qualquer data do Excel
        if isinstance(val, datetime.datetime):
            h, m, s = val.hour, val.minute, val.second
        elif isinstance(val, (float, int)):
            seconds = int(val * 86400)
            h, m, s = (seconds // 3600) % 24, (seconds // 60) % 60, seconds % 60
        else:
            val_str = str(val).replace(',', '.') # Transforma "00:00:00,00" em "00:00:00.00"
            time_part = val_str.split(' ')[-1] if ' ' in val_str else val_str
            parts = time_part.split(':')
            h = int(parts[0])
            m = int(parts[1])
            # Trata o segundo com milissegundos (ex: 00.00)
            s_full = float(parts[2])
            s = int(s_full)
            ms = int((s_full - s) * 1000)
        
        # FORÇA A DATA PARA HOJE
        dt = now.replace(hour=h, minute=m, second=s, microsecond=ms * 1000)
        
        # Se a hora for muito no futuro (ex: Excel marca 23:00 e agora é 01:00 da manhã),
        # aí sim assumimos que é o dia anterior (final da noite passada).
        if dt > now + datetime.timedelta(hours=4): 
            dt -= datetime.timedelta(days=1)

        return int(dt.timestamp() * 1000), dt.strftime('%H:%M:%S')
    except:
        return None, None

def read_historical_data(sent_buffer):
    """Lê a aba Histórico dinamicamente (Colunas A, C, D, F)"""
    global last_historical_ts
    sheet_h = get_sheet(SHEET_HISTORICO)
    if not sheet_h:
        print(f"[HISTORICO]: Aba '{SHEET_HISTORICO}' não encontrada.")
        return
    
    print(f"[HISTORICO]: Detectando tamanho do histórico...")
    # Encontra a última linha preenchida na coluna A
    last_row = sheet_h.range("A" + str(sheet_h.cells.last_cell.row)).end('up').row
    if last_row < 2: 
        print("[HISTORICO]: Aba vazia.")
        return

    print(f"[HISTORICO]: Lendo {last_row - 1} linhas...")
    # Lê as colunas A até F (0 a 5 no índice Python)
    data = sheet_h.range(f"A2:F{last_row}").value
    if not isinstance(data[0], list): data = [data] # Trata caso de 1 única linha

    now = datetime.datetime.now()
    hist_trades = []
    counters = {}

    for row in data:
        if not row or len(row) < 6: continue
        
        time_val = row[0]   # Coluna A
        price_val = row[2]  # Coluna C
        qty_val = row[3]    # Coluna D
        side_val = str(row[5]).upper() # Coluna F (Agressor)

        if time_val and price_val and qty_val:
            ts, time_str = process_time(time_val, now)
            if ts:
                price, qty = float(price_val), int(qty_val)
                # Normaliza o lado (Compra/Venda, Buy/Sell, etc)
                side = "BUY" if "C" in side_val or "B" in side_val else "SELL"
                
                sig = f"{side}_{time_str}_{price}_{qty}"
                counters[sig] = counters.get(sig, 0) + 1
                uid = f"{sig}_{counters[sig]}"
                
                if uid not in sent_buffer:
                    hist_trades.append({"id": uid, "timestamp": ts, "price": price, "quantity": qty, "side": side})
                    sent_buffer.add(uid)
                    if ts > last_historical_ts: last_historical_ts = ts

    if hist_trades:
        print(f"[HISTORICO]: Enviando {len(hist_trades)} trades históricos...")
        for i in range(0, len(hist_trades), 500):
            tx_queue.put({"trades": hist_trades[i:i+500], "last_price": 0, "variation": 0})
        print(f"[HISTORICO]: Finalizado. Sincronizado até {datetime.datetime.fromtimestamp(last_historical_ts/1000).strftime('%H:%M:%S')}")

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
    
    while True:
        try:
            if not is_active:
                if historical_loaded: # Se estava ligado e agora desligou
                    print("[STATUS]: Motor em STANDBY. Limpando memória local...")
                    sent_trades_buffer.clear()
                    historical_loaded = False
                time.sleep(1)
                continue

            if not historical_loaded:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Motor Ligado! Resetando banco e carregando dados...")
                clear_database() # Limpa o banco de dados na nuvem para a nova sessão
                read_historical_data(sent_trades_buffer)
                historical_loaded = True

            if not sheet_rtd:
                sheet_rtd = get_sheet(SHEET_RTD)
                if not sheet_rtd:
                    time.sleep(2)
                    continue
                print(f"Conectado à aba {SHEET_RTD}. Iniciando Tempo Real...")

            # O RTD continua na lógica antiga de duas colunas (comum em RTDs de fluxo)
            data = sheet_rtd.range("A2:J507").value
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
                # COMPRA (A, B, C no RTD)
                if row[0] and row[1] and row[2]:
                    ts, time_str = process_time(row[0], now)
                    if ts and ts >= last_historical_ts:
                        price, qty = float(row[1]), int(row[2])
                        sig = f"BUY_{time_str}_{price}_{qty}"
                        counters[sig] = counters.get(sig, 0) + 1
                        uid = f"{sig}_{counters[sig]}"
                        if uid not in sent_trades_buffer:
                            new_trades.append({"id": uid, "timestamp": ts, "price": price, "quantity": qty, "side": "BUY"})
                            sent_trades_buffer.add(uid)
                # VENDA (G, H, I no RTD)
                if row[6] and row[7] and row[8]:
                    ts, time_str = process_time(row[6], now)
                    if ts and ts >= last_historical_ts:
                        price, qty = float(row[7]), int(row[8])
                        sig = f"SELL_{time_str}_{price}_{qty}"
                        counters[sig] = counters.get(sig, 0) + 1
                        uid = f"{sig}_{counters[sig]}"
                        if uid not in sent_trades_buffer:
                            new_trades.append({"id": uid, "timestamp": ts, "price": price, "quantity": qty, "side": "SELL"})
                            sent_trades_buffer.add(uid)

            if len(sent_trades_buffer) > 35000:
                sent_trades_buffer = set(list(sent_trades_buffer)[-15000:])

            p_changed = abs(current_price - last_price_sent) > 0.0001
            v_changed = abs(current_variation - last_variation_sent) > 0.0001
            
            if new_trades or p_changed or v_changed:
                if new_trades: new_trades.sort(key=lambda x: x['timestamp'])
                tx_queue.put({"trades": new_trades, "last_price": current_price, "variation": current_variation})
                last_price_sent, last_variation_sent = current_price, current_variation

            time.sleep(SCAN_INTERVAL)
        except Exception as e:
            print(f"[LOOP ERROR]: {e}")
            sheet_rtd = None
            time.sleep(1)

if __name__ == "__main__":
    main()
