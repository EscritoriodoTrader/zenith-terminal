import xlwings as xw
import time
import requests
import datetime
import threading
import queue

# ==========================================
# CONFIGURAÇÕES DO SISTEMA
# ==========================================
EXCEL_FILE_NAME = "Fluxo.xlsm"
SHEET_NAME = "Dados_RTD"
# URL do servidor Node.js
SERVER_URL = "https://zenith-terminal-bvj4.onrender.com"
POST_URL = f"{SERVER_URL}/api/trades"
SCAN_INTERVAL = 0.005 # 5ms para alta frequência

# Fila de transmissão e Sincronização
tx_queue = queue.Queue()
session = requests.Session()

def tx_worker():
    """Worker para enviar dados ao servidor Node.js sem travar a leitura do Excel"""
    print("[TX]: Canal de transmissão iniciado.")
    while True:
        try:
            payload = tx_queue.get()
            if payload is None: break
            
            try:
                # Envia o pacote de trades/market data
                session.post(SERVER_URL, json=payload, timeout=1)
            except Exception as e:
                print(f"[TX ERROR]: Falha ao enviar dados: {e}")
            
            tx_queue.task_done()
        except Exception:
            time.sleep(0.1)

# Inicia o worker de transmissão em background
threading.Thread(target=tx_worker, daemon=True).start()

def get_excel_app():
    """Tenta conectar ao arquivo Excel aberto usando xlwings"""
    try:
        # Tenta encontrar o livro pelo nome
        for app in xw.apps:
            for book in app.books:
                if EXCEL_FILE_NAME in book.name:
                    return book.sheets[SHEET_NAME]
        return None
    except Exception as e:
        print(f"[EXCEL ERROR]: Erro ao buscar instância: {e}")
        return None

def process_time(val, now):
    """Converte o valor de tempo do Excel para Timestamp MS"""
    try:
        if isinstance(val, (float, int)):
            # Formato Excel: fração do dia
            seconds = int(val * 86400)
            h, m, s = (seconds // 3600) % 24, (seconds // 60) % 60, seconds % 60
        else:
            # Formato String "HH:MM:SS"
            parts = str(val).split(':')
            h = int(parts[0])
            m = int(parts[1])
            s = int(parts[2].split('.')[0]) if len(parts) > 2 else 0
        
        dt = now.replace(hour=h, minute=m, second=s, microsecond=0)
        # Ajuste para virada do dia
        if dt > now + datetime.timedelta(minutes=1):
            dt -= datetime.timedelta(days=1)
            
        return int(dt.timestamp() * 1000), f"{h:02d}:{m:02d}:{s:02d}"
    except:
        return None, None

def main():
    print("--- ZENITH SCANNER V5.0: XLWINGS ENGINE ---")
    
    sheet = None
    sent_trades_buffer = set()
    last_price_sent = 0
    last_variation_sent = -999
    
    while True:
        try:
            if not sheet:
                sheet = get_excel_app()
                if not sheet:
                    print(f"Aguardando arquivo '{EXCEL_FILE_NAME}' e aba '{SHEET_NAME}'...")
                    time.sleep(2)
                    continue
                print(f"Conectado ao {EXCEL_FILE_NAME} com sucesso via xlwings.")

            # Leitura do bloco de dados (Otimizado para 1 única chamada)
            # A2:J507 cobre Price, Var e a grade de trades
            data = sheet.range("A2:J507").value
            
            if not data or not data[0]:
                time.sleep(0.1)
                continue

            # Extração de Dados de Mercado (C2 e H2)
            # data[0][2] = Coluna C, data[0][7] = Coluna H
            current_price = data[0][2] or 0
            current_variation = data[0][7] or 0
            
            # Extração de Trades (Começa na linha 8 do Excel -> índice 6 da matriz data)
            trade_rows = data[6:]
            now = datetime.datetime.now()
            new_trades = []
            
            # Contadores para garantir unicidade no mesmo segundo/preço
            counters = {}

            for row in trade_rows:
                # Lógica para COMPRA (BUY): Colunas A, B, C
                if row[0] and row[1] and row[2]:
                    ts, time_str = process_time(row[0], now)
                    if ts:
                        price = float(row[1])
                        qty = int(row[2])
                        sig = f"BUY_{time_str}_{price}_{qty}"
                        counters[sig] = counters.get(sig, 0) + 1
                        uid = f"{sig}_{counters[sig]}"
                        
                        if uid not in sent_trades_buffer:
                            new_trades.append({
                                "id": uid, 
                                "timestamp": ts, 
                                "price": price, 
                                "quantity": qty, 
                                "side": "BUY"
                            })
                            sent_trades_buffer.add(uid)

                # Lógica para VENDA (SELL): Colunas G, H, I
                if row[6] and row[7] and row[8]:
                    ts, time_str = process_time(row[6], now)
                    if ts:
                        price = float(row[7])
                        qty = int(row[8])
                        sig = f"SELL_{time_str}_{price}_{qty}"
                        counters[sig] = counters.get(sig, 0) + 1
                        uid = f"{sig}_{counters[sig]}"
                        
                        if uid not in sent_trades_buffer:
                            new_trades.append({
                                "id": uid, 
                                "timestamp": ts, 
                                "price": price, 
                                "quantity": qty, 
                                "side": "SELL"
                            })
                            sent_trades_buffer.add(uid)

            # Limpeza inteligente do buffer de IDs
            if len(sent_trades_buffer) > 15000:
                # Mantém apenas os últimos 5000 IDs para economizar memória
                sent_trades_buffer = set(list(sent_trades_buffer)[-5000:])

            # Verificação de Mudança (Price, Var ou Novos Trades)
            price_changed = abs(current_price - last_price_sent) > 0.0001
            var_changed = abs(current_variation - last_variation_sent) > 0.0001
            
            if new_trades or price_changed or var_changed:
                # Ordena trades pelo timestamp (mais antigo primeiro)
                if new_trades:
                    new_trades.sort(key=lambda x: x['timestamp'])
                
                payload = {
                    "trades": new_trades,
                    "last_price": current_price,
                    "variation": current_variation
                }
                tx_queue.put(payload)
                
                last_price_sent = current_price
                last_variation_sent = current_variation

            time.sleep(SCAN_INTERVAL)

        except Exception as e:
            # Se o Excel fechar ou der erro de "Busy", tenta reconectar
            print(f"[LOOP ERROR]: {e}")
            sheet = None
            time.sleep(1)

if __name__ == "__main__":
    main()
