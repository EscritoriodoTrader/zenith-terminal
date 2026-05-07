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

# Tenta usar Localhost se o server estiver rodando na mesma máquina
LOCAL_SERVER = "127.0.0.1:10000"
REMOTE_SERVER = "zenith-terminal-bvj4.onrender.com"
SERVER_HOST = REMOTE_SERVER 

# Detecta se é local ou remoto para o protocolo HTTP
HTTP_PROTOCOL = "http" if "localhost" in SERVER_HOST or "127.0.0.1" in SERVER_HOST else "https"
POST_URL = f"{HTTP_PROTOCOL}://{SERVER_HOST}/api/trades"
SCAN_INTERVAL = 0.001 # Velocidade Ultra-Rápida

# Trava de Instância Única (Evita dois Pythons rodando)
import socket
try:
    lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lock_socket.bind(("127.0.0.1", 12345)) # Porta de trava arbitrária
except socket.error:
    print("[ERRO]: Já existe um motor Zenith rodando! Feche o anterior antes de iniciar.")
    exit()

# Fila de transmissão e Sincronização
tx_queue = queue.Queue()
session = requests.Session()
is_active = False 
last_historical_ts = 0 

ws_client = None

history_requested = False
history_already_read = False
last_ts_received = False
sent_trades_buffer = set()

def on_message(ws, message):
    global is_active, ws_client, history_requested, history_already_read, sent_trades_buffer
    ws_client = ws
    try:
        msg = json.loads(message)
        t = msg.get('type')
        if t in ['MOTOR_STATUS', 'TOGGLE_MOTOR']:
            is_active = msg.get('running', False)
            print(f"[COMANDO]: Motor {'LIGADO' if is_active else 'DESLIGADO'}")
        elif t == 'GET_HISTORY':
            pass 
        elif t == 'LAST_TS':
            global last_ts_received
            last_historical_ts = msg.get('data', 0)
            last_ts_received = True
            if last_historical_ts > 0:
                print(f"[SISTEMA]: O servidor já possui histórico até a data {(datetime.datetime.fromtimestamp(last_historical_ts/1000.0)).strftime('%d/%m %H:%M:%S')}")
            else:
                print("[SISTEMA]: O banco do servidor está limpo.")
        elif t == 'CLEAR_CHART':
            history_already_read = False
            last_ts_received = False
            last_historical_ts = 0
            sent_trades_buffer.clear()
            print("[SISTEMA]: Comando de RESET recebido. Memória de IDs limpa e aba 'Historico' liberada.")
        elif t == 'SHUTDOWN':
            print("[SISTEMA]: Encerrando motor por comando remoto...")
            import os
            os._exit(0)
    except: pass

def start_ws():
    def run():
        global ws_client
        print(f"[WS]: Iniciando conexão com o servidor em {SERVER_HOST}...")
        def on_open(ws):
            global ws_client
            ws_client = ws
            print(f"[WS]: Túnel de dados CONECTADO em {ws_url}")
            # Manda um "Oi" para o gráfico só para testar o canal e avisar que o Python está online
            try:
                ws.send(json.dumps({"type": "PING", "origin": "PYTHON_MOTOR"}))
                ws.send(json.dumps({"type": "PYTHON_CONNECT"}))
                ws.send(json.dumps({"type": "GET_LAST_TS"}))
            except: pass

        while True:
            try:
                protocol = "ws" if "localhost" in SERVER_HOST or "127.0.0.1" in SERVER_HOST else "wss"
                ws_url = f"{protocol}://{SERVER_HOST}"
                
                ws = websocket.WebSocketApp(ws_url, on_message=on_message, on_open=on_open)
                ws.run_forever()
            except Exception as e:
                print(f"[WS]: Erro na conexão: {e}")
            time.sleep(2)
    threading.Thread(target=run, daemon=True).start()

# start_ws() <- REMOVIDO: Agora é chamado dentro do loop principal para resiliência

def tx_worker():
    print("[TX]: Canal de transmissão iniciado.")
    consecutive_failures = 0
    while True:
        try:
            payload = tx_queue.get()
            if payload is None: break
            
            sent_ws = False
            # TENTA WS
            if ws_client and ws_client.sock and ws_client.sock.connected:
                try:
                    ws_client.send(json.dumps({
                        "type": "NEW_DATA",
                        "asset": payload.get("asset", "---"),
                        "data": payload.get("data", []),
                        "lastPrice": payload.get("lastPrice", 0),
                        "variation": payload.get("variation", 0)
                    }))
                    sent_ws = True
                    consecutive_failures = 0 
                except: pass
            
            # SE FALHAR WS, TENTA HTTP
            if not sent_ws:
                try:
                    res = session.post(POST_URL, json=payload, timeout=2)
                    if res.status_code == 200:
                        consecutive_failures = 0
                    else:
                        consecutive_failures += 1
                except:
                    consecutive_failures += 1
            
            # SE FALHAR TUDO POR MUITO TEMPO, AVISA E TENTA RECONECTAR
            if consecutive_failures > 50:
                print("\n[ALERTA]: Conexão perdida com o terminal. Tentando reconectar em vez de encerrar...")
                time.sleep(2)
                consecutive_failures = 0
                
            tx_queue.task_done()
        except Exception as e:
            consecutive_failures += 1
            time.sleep(1)

def clear_database():
    try:
        print("[INIT]: Solicitando limpeza do banco de dados para nova sessão...")
        requests.delete(f"{HTTP_PROTOCOL}://{SERVER_HOST}/api/trades/clear", timeout=5)
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
        if not val: return None, None
        ms = 0
        h, m, s = 0, 0, 0

        if isinstance(val, datetime.datetime):
            h, m, s, ms = val.hour, val.minute, val.second, val.microsecond // 1000
        elif isinstance(val, (float, int)):
            # Formato Serial do Excel
            seconds = int(val * 86400)
            h, m, s = (seconds // 3600) % 24, (seconds // 60) % 60, seconds % 60
        else:
            v_str = str(val).strip().replace(',', '.')
            time_part = v_str.split(' ')[-1] if ' ' in v_str else v_str
            
            if '.' in time_part:
                time_part, ms_str = time_part.split('.')
                ms = int(ms_str[:3].ljust(3, '0'))
            
            p = time_part.split(':')
            h = int(p[0])
            m = int(p[1]) if len(p) > 1 else 0
            s = int(p[2]) if len(p) > 2 else 0

        dt = now.replace(hour=h, minute=m, second=s, microsecond=ms * 1000)
        # Ajuste de Fuso Horário/Virada de Dia
        if dt > now + datetime.timedelta(hours=2): 
            dt -= datetime.timedelta(days=1)
            
        return int(dt.timestamp() * 1000), dt.strftime('%H:%M:%S')
    except Exception as e:
        return None, None

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

def clean_variation(val):
    try:
        if isinstance(val, (float, int)): 
            n = float(val)
        else:
            s = str(val).strip().replace(' ', '').replace('%', '')
            if ',' in s and '.' in s: s = s.replace('.', '').replace(',', '.')
            elif ',' in s: s = s.replace(',', '.')
            n = float(s)
        
        # Ajuste de Escala (Ex: 139.0 -> 1.39)
        if abs(n) > 10: n = n / 100.0
        return n
    except: return 0.0

# Bandeira para controle de leitura da aba 'Historico'
history_already_read = False
last_history_uid = None

def normalize_side(val):
    """Converte termos do Excel para o padrao BUY/SELL baseando-se na letra inicial"""
    if not val: return "BUY"
    s = str(val).upper().strip()
    if s.startswith('V') or s.startswith('S'): return "SELL"
    if s.startswith('C') or s.startswith('B'): return "BUY"
    return "BUY"

def read_excel_history(sent_buffer):
    """
    Lê a aba 'Historico' do Excel (Colunas A, C, D, F)
    Mapping: A=Horário, C=Preço, D=Quantidade, F=Agressor
    """
    global history_already_read, last_history_uid
    
    try:
        sheet_hist = get_sheet("Historico")
        if not sheet_hist: return
            
        print("[SISTEMA]: Sincronizando aba 'Historico' com Precisão BlackArrow...")
        
        last_row = sheet_hist.range("A" + str(sheet_hist.cells.last_cell.row)).end('up').row
        if last_row < 2: return
        
        data = sheet_hist.range(f"A2:F{last_row}").value
        if not isinstance(data[0], list): data = [data]
        
        hist_trades = []
        temp_last_uid = None
        now = datetime.datetime.now()
        
        # Contador para trades no mesmo milissegundo
        ts_counters = {}
        
        for row in data:
            # REGRA DE PARADA: Se os 4 campos vitais estiverem vazios, o histórico acabou.
            if not row[0] and not row[2] and not row[3] and not row[5]:
                break
                
            # Se a linha for parcialmente inválida, pula para a próxima mas não para o processo
            if not row[0] or row[2] is None or row[3] is None:
                continue
                
            ts, time_str = process_time(row[0], now)
            
            if ts <= last_historical_ts:
                continue
                
            p = clean_price(row[2])
            q = int(float(str(row[3]).replace(',', '.')))
            side = normalize_side(row[5])
            
            if len(hist_trades) < 5:
                print(f"[DEBUG]: Lendo linha {len(hist_trades)+2} | Agressor Original: '{row[5]}' -> Traduzido para: {side}")
            elif len(hist_trades) % 5000 == 0:
                print(f"[SISTEMA]: Lendo histórico... já processados {len(hist_trades)} trades.")
            
            # Gera ID Único com Sequência para não perder trades idênticos
            base_id = f"{side}_{ts}_{p}_{q}"
            ts_counters[base_id] = ts_counters.get(base_id, 0) + 1
            uid = f"{base_id}_seq{ts_counters[base_id]}"
            
            if uid not in sent_buffer:
                hist_trades.append({"id": uid, "timestamp": ts, "price": p, "quantity": q, "side": side})
                sent_buffer.add(uid)
                temp_last_uid = uid
        
        if hist_trades:
            for i in range(0, len(hist_trades), 1000):
                batch = hist_trades[i:i+1000]
                ws_client.send(json.dumps({"type": "NEW_DATA", "asset": "HISTORICO", "data": batch}))
                if (i // 1000) % 20 == 0 and i > 0:
                    print(f"[SISTEMA]: Enviando histórico para a nuvem... {i} trades enviados.")
            
            last_history_uid = temp_last_uid
            print(f"[SISTEMA]: Sincronização concluída. {len(hist_trades)} trades enviados para a nuvem.")
        
        history_already_read = True
    except Exception as e:
        print(f"[ERRO HISTORICO]: {e}")

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
        tx_queue.put({"data": hist_trades, "lastPrice": hist_trades[-1]['price'], "variation": 0})

def main():
    global last_historical_ts, history_already_read, sent_trades_buffer, is_active
    print("--- ZENITH SCANNER V6.9.1: MOTOR SINCRONIZADO ---")
    threading.Thread(target=tx_worker, daemon=True).start()
    
    sheet_rtd = None
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

            if not history_already_read and is_active:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Motor Ligado! Verificando histórico na nuvem...")
                
                # Espera o servidor devolver qual foi o último trade salvo
                wait_start = time.time()
                while not last_ts_received and time.time() - wait_start < 5:
                    time.sleep(0.1)
                    
                read_excel_history(sent_trades_buffer)
                historical_loaded = True

            if not sheet_rtd:
                # Tenta vários nomes comuns de abas
                for name in ["Dados_RTD", "RTD", "Fluxo", "Planilha1"]:
                    sheet_rtd = get_sheet(name)
                    if sheet_rtd: 
                        print(f"[RTD]: Conectado com sucesso à aba '{name}'.")
                        break
                
                if not sheet_rtd:
                    print("[AVISO]: Não encontrei a aba de dados no Excel. Verifique se o nome é 'Dados_RTD' ou 'RTD'.")
                    time.sleep(5)
                    continue

            # Leitura do Tempo Real (Duas Tabelas: Compra A-D | Venda G-J)
            data = sheet_rtd.range("A8:J507").value
            if not data or not data[0]:
                time.sleep(0.1)
                continue

            # Leitura do Cabeçalho (Ativo A2 | Preço C2 | Variação H2)
            try:
                asset_name = str(sheet_rtd.range("A2").value or "---")
                current_price = clean_price(sheet_rtd.range("C2").value)
                variation = clean_variation(sheet_rtd.range("H2").value)
                
                variation = clean_variation(sheet_rtd.range("H2").value)
            except:
                asset_name = "---"
                current_price = 0
                variation = 0
            
            new_trades = []
            now = datetime.datetime.now()
            ts_counters = {}

            global history_requested
            for row in data:
                if not row: continue

                # COMPRAS (Coluna A-D)
                try:
                    if row[0] and row[1] and row[2]:
                        ts, time_str = process_time(row[0], now)
                        if ts and ts >= last_historical_ts:
                            p = clean_price(row[1])
                            q = int(float(str(row[2]).replace(',', '.')))
                            side = "BUY"
                            
                            base_id = f"{side}_{ts}_{p}_{q}"
                            ts_counters[base_id] = ts_counters.get(base_id, 0) + 1
                            uid = f"{base_id}_seq{ts_counters[base_id]}"
                            
                            if uid not in sent_trades_buffer:
                                new_trades.append({"id": uid, "timestamp": ts, "price": p, "quantity": q, "side": side})
                                sent_trades_buffer.add(uid)
                except Exception as e:
                    pass

                # VENDAS (Coluna G-J)
                try:
                    if row[6] and row[7] and row[8]:
                        ts, time_str = process_time(row[6], now)
                        if ts and ts >= last_historical_ts:
                            p = clean_price(row[7])
                            q = int(float(str(row[8]).replace(',', '.')))
                            side = "SELL"
                            
                            base_id = f"{side}_{ts}_{p}_{q}"
                            ts_counters[base_id] = ts_counters.get(base_id, 0) + 1
                            uid = f"{base_id}_seq{ts_counters[base_id]}"
                            
                            if uid not in sent_trades_buffer:
                                new_trades.append({"id": uid, "timestamp": ts, "price": p, "quantity": q, "side": side})
                                sent_trades_buffer.add(uid)
                except Exception as e:
                    pass

            # Sincronização de histórico finalizada

            if len(sent_trades_buffer) > 40000:
                sent_trades_buffer = set(list(sent_trades_buffer)[-20000:])

            # Transmissão de Dados
            if new_trades or current_price != last_price_sent or variation != last_variation_sent:
                if new_trades:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] >>> ENVIANDO {len(new_trades)} NEGÓCIOS | {asset_name} | {current_price} <<<")
                
                if new_trades: new_trades.sort(key=lambda x: x['timestamp'])
                
                tx_queue.put({
                    "type": "NEW_DATA",
                    "asset": asset_name,
                    "data": new_trades, 
                    "lastPrice": current_price, 
                    "variation": variation
                })
                last_price_sent = current_price
                last_variation_sent = variation
            else:
                if time.time() - last_wait_log > 2:
                    status_motor = "LIGADO" if is_active else "STANDBY"
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [VIVO] Motor: {status_motor} | Ativo: {asset_name} | Lendo RTD...")
                    last_wait_log = time.time()

            time.sleep(SCAN_INTERVAL)
        except Exception as e:
            print(f"[RTD ERROR]: {e}")
            sheet_rtd = None
            time.sleep(1)

if __name__ == "__main__":
    while True:
        try:
            print("\n" + "="*50)
            print("🚀 ZENITH SCANNER V6.0: MOTOR DE ALTA RESILIÊNCIA")
            print("="*50)
            
            # Limpa instâncias antigas e reinicia o rádio
            start_ws()
            
            # Inicia o motor de leitura
            main()
            
        except KeyboardInterrupt:
            print("\n[SISTEMA]: Encerrando pelo usuário...")
            break
        except Exception as e:
            print(f"\n[ERRO CRÍTICO NO MOTOR]: {e}")
            print("[SISTEMA]: Reiniciando motor completo em 5 segundos...")
            time.sleep(5)
