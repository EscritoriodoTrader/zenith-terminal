import time
import requests
import datetime
import threading
import queue
import websocket
import json
import concurrent.futures
import pythoncom
import socket
# CONFIGURAÇÕES DO SISTEMA
# ==========================================
# Não usamos mais Excel!

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

class DirectRTDClient:
    def __init__(self):
        self.rtd = None
        self.callback = None
        self.ExcelLib = None
        self.asset_name = "---"
        self.topics = {} 
        self.data_cache = {}
        self.info_subscribed = False  # Flag para assinar info apos saber o ativo
        self.next_tid = 5000          # IDs reservados para os canais de info
        self.last_known_asset = None  # Detecta troca de ativo ao vivo
        
        try:
            import comtypes.client
            try:
                self.ExcelLib = comtypes.client.GetModule(('{00020813-0000-0000-C000-000000000046}', 1, 9))
            except Exception:
                self.ExcelLib = comtypes.client.GetModule(('{00020813-0000-0000-C000-000000000046}', 1, 8))
        except Exception as e:
            print("[RTD DIRETO ERRO]: Nao foi possivel carregar comtypes ou ExcelLib.")
            raise e

    def connect(self):
        import comtypes.client
        from comtypes import COMObject
        print("[RTD DIRETO]: Iniciando conexão COM com a BlackArrow...")
        self.rtd = comtypes.client.CreateObject("rtdtrading.rtdserver", interface=self.ExcelLib.IRtdServer)
        
        class RTDCallback(COMObject):
            _com_interfaces_ = [self.ExcelLib.IRTDUpdateEvent]
            def __init__(self, client):
                super(RTDCallback, self).__init__()
                self.client = client
                self._HeartbeatInterval = -1
                self.has_updates = False
            def UpdateNotify(self):
                self.has_updates = True
            def _get_HeartbeatInterval(self): return self._HeartbeatInterval
            def _set_HeartbeatInterval(self, value): self._HeartbeatInterval = value
            def Disconnect(self): pass
            
        self.callback = RTDCallback(self)
        # HeartbeatInterval positivo faz o servidor RTD enviar dados periodicamente
        # mesmo que nao haja mudancas (resolve o problema do valor inicial)
        self.callback._HeartbeatInterval = 1000  # 1 segundo
        self.rtd.ServerStart(self.callback)
        print("[RTD DIRETO]: Conexão estabelecida! Assinando canais...")
        
        self._subscribe(1, ("T&T0", "INFO", "ATV"), "ASSET_NAME")
        self._subscribe(2, ("T&T0", "INFO", "TAB"), "ORDER_INFO")
        
        # T&T tem 500 traders de cada lado (0 a 499)
        self.max_tt_lines = 500
        tid = 10
        for i in range(self.max_tt_lines):
            self._subscribe(tid, ("T&T0", "DAT", str(i)), f"BUY_DAT_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "PRE", str(i)), f"BUY_PRE_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "QUL", str(i)), f"BUY_QUL_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "AGR", str(i)), f"BUY_AGR_{i}"); tid+=1
            
            self._subscribe(tid, ("T&T1", "DAT", str(i)), f"SELL_DAT_{i}"); tid+=1
            self._subscribe(tid, ("T&T1", "PRE", str(i)), f"SELL_PRE_{i}"); tid+=1
            self._subscribe(tid, ("T&T1", "QUL", str(i)), f"SELL_QUL_{i}"); tid+=1
            self._subscribe(tid, ("T&T1", "AGR", str(i)), f"SELL_AGR_{i}"); tid+=1
            
        print(f"[RTD DIRETO]: {tid} canais assinados (500 traders por T&T). Zero dependencia de Excel!")
        
        # Forca uma primeira leitura imediata para pegar os valores iniciais
        # sem depender do callback UpdateNotify
        time.sleep(0.5)  # Aguarda o servidor processar todas as assinaturas
        self._force_refresh()

    def _force_refresh(self):
        """Le todos os dados disponiveis agora, sem esperar o UpdateNotify"""
        try:
            import pythoncom
            pythoncom.PumpWaitingMessages()
            result = self.rtd.RefreshData(0)
            if result and len(result) >= 2:
                safearray = result[1]
                if safearray and len(safearray) == 2:
                    topic_ids = safearray[0]
                    values = safearray[1]
                    for i in range(len(topic_ids)):
                        tid = topic_ids[i]
                        val = values[i]
                        if tid in self.topics:
                            self.data_cache[self.topics[tid]] = val
            # Verifica se ja temos nome do ativo nos dados iniciais
            raw_name = self.data_cache.get("ASSET_NAME", "")
            if raw_name and str(raw_name).strip() not in ("", "---", "None"):
                new_name = str(raw_name).strip()
                print(f"[RTD DIRETO]: Nome do ativo detectado na leitura inicial: {new_name}")
                self._subscribe_info(new_name)
                self.last_known_asset = new_name
        except Exception as e:
            print(f"[RTD DIRETO]: Aviso na leitura inicial: {e}")

    def _subscribe_info(self, symbol):
        """Assina os canais informativos (max, min, abertura, ultimo, vwap, var) de forma dinamica"""
        print(f"[RTD DIRETO]: Assinando canais informativos para o ativo: {symbol}")
        tid = self.next_tid
        self._subscribe(tid, (symbol, "ULT"), "INFO_ULTIMO");   tid += 1
        self._subscribe(tid, (symbol, "ABE"), "INFO_ABERTURA"); tid += 1
        self._subscribe(tid, (symbol, "MAX"), "INFO_MAXIMA");   tid += 1
        self._subscribe(tid, (symbol, "MIN"), "INFO_MINIMA");   tid += 1
        self._subscribe(tid, (symbol, "FEC"), "INFO_FECHAMENTO"); tid += 1
        self._subscribe(tid, (symbol, "VAR"), "INFO_VARIACAO"); tid += 1
        self._subscribe(tid, (symbol, "AJA"), "INFO_AJUSTE");   tid += 1
        self._subscribe(tid, (symbol, "100"), "INFO_VOLUME");   tid += 1
        self._subscribe(tid, (symbol, "67"),  "INFO_VWAP");     tid += 1
        self.next_tid = tid
        self.info_subscribed = True
        print(f"[RTD DIRETO]: Canais informativos de {symbol} assinados com sucesso!")
        
    def _subscribe(self, topic_id, args, internal_name):
        try:
            self.rtd.ConnectData(topic_id, args, True)
            self.topics[topic_id] = internal_name
        except Exception:
            pass
            
    def _unsubscribe_info(self):
        """Cancela assinatura dos canais informativos do ativo anterior"""
        info_keys = ["INFO_ULTIMO","INFO_ABERTURA","INFO_MAXIMA","INFO_MINIMA",
                     "INFO_FECHAMENTO","INFO_VARIACAO","INFO_AJUSTE","INFO_VOLUME","INFO_VWAP"]
        for key in info_keys:
            self.data_cache.pop(key, None)
        # Cancela as inscricoes pelo reverse lookup de topics
        tids_to_remove = [tid for tid, name in self.topics.items() if name in info_keys]
        for tid in tids_to_remove:
            try: self.rtd.DisconnectData(tid)
            except: pass
            del self.topics[tid]
        self.info_subscribed = False
        print("[RTD DIRETO]: Canais informativos do ativo anterior cancelados.")

    def refresh(self):
        import pythoncom
        pythoncom.PumpWaitingMessages()
        
        if self.callback.has_updates:
            self.callback.has_updates = False
            result = self.rtd.RefreshData(0)
            if result and len(result) >= 2:
                topic_count = result[0]
                safearray = result[1]
                if safearray and len(safearray) == 2:
                    topic_ids = safearray[0]
                    values = safearray[1]
                    for i in range(len(topic_ids)):
                        tid = topic_ids[i]
                        val = values[i]
                        if tid in self.topics:
                            self.data_cache[self.topics[tid]] = val
            
            # Apos primeiro refresh, verifica se ja temos o nome do ativo
            # Tambem detecta mudanca de ativo ao vivo
            if not self.info_subscribed or self.data_cache.get("ASSET_NAME") != self.last_known_asset:
                raw_name = self.data_cache.get("ASSET_NAME", "")
                if raw_name and str(raw_name).strip() and str(raw_name).strip() not in ("", "---"):
                    new_name = str(raw_name).strip()
                    if new_name != self.last_known_asset:
                        if self.info_subscribed:
                            # Ativo mudou! Cancela o antigo e assina o novo
                            old_name = self.last_known_asset
                            print(f"[RTD DIRETO]: Troca de ativo detectada! {old_name} -> {new_name}")
                            self._unsubscribe_info()
                            # Notifica o frontend para resetar o grafico automaticamente
                            try:
                                if ws_client and ws_client.sock and ws_client.sock.connected:
                                    ws_client.send(json.dumps({
                                        "type": "ASSET_CHANGED",
                                        "oldAsset": old_name,
                                        "newAsset": new_name
                                    }))
                                    print(f"[RTD DIRETO]: Sinal ASSET_CHANGED enviado ao grafico: {old_name} -> {new_name}")
                            except Exception as e:
                                print(f"[RTD DIRETO]: Erro ao notificar troca de ativo: {e}")
                        self._subscribe_info(new_name)
                        self.last_known_asset = new_name
            return True
        return False
        
    def get_trades(self):
        buys = []
        sells = []
        for i in range(self.max_tt_lines):
            dt = self.data_cache.get(f"BUY_DAT_{i}")
            pr = self.data_cache.get(f"BUY_PRE_{i}")
            qt = self.data_cache.get(f"BUY_QUL_{i}")
            ag = self.data_cache.get(f"BUY_AGR_{i}")
            
            if dt and pr and qt:
                ag_val = str(ag).strip().upper() if ag else ""
                if "VEND" in ag_val or "S" in ag_val: side = "SELL"
                else: side = "BUY"
                buys.append((dt, pr, qt, side))
                
            dt_s = self.data_cache.get(f"SELL_DAT_{i}")
            pr_s = self.data_cache.get(f"SELL_PRE_{i}")
            qt_s = self.data_cache.get(f"SELL_QUL_{i}")
            ag_s = self.data_cache.get(f"SELL_AGR_{i}")
            
            if dt_s and pr_s and qt_s:
                ag_s_val = str(ag_s).strip().upper() if ag_s else ""
                if "COMPR" in ag_s_val or "B" in ag_s_val: side = "BUY"
                else: side = "SELL"
                sells.append((dt_s, pr_s, qt_s, side))
                
        self.asset_name = str(self.data_cache.get("ASSET_NAME", "---"))
        
        # Prioridade para info RTD informativo, fallback para o preco do ultimo trade
        last_price = clean_price(self.data_cache.get("INFO_ULTIMO", 0)) or 0
        if not last_price:
            if self.data_cache.get("BUY_PRE_0"): last_price = self.data_cache.get("BUY_PRE_0")
            elif self.data_cache.get("SELL_PRE_0"): last_price = self.data_cache.get("SELL_PRE_0")
        
        variation = clean_variation(self.data_cache.get("INFO_VARIACAO", 0)) or 0
        
        info = {
            "ultimo":     self.data_cache.get("INFO_ULTIMO"),
            "abertura":   self.data_cache.get("INFO_ABERTURA"),
            "maxima":     self.data_cache.get("INFO_MAXIMA"),
            "minima":     self.data_cache.get("INFO_MINIMA"),
            "fechamento": self.data_cache.get("INFO_FECHAMENTO"),
            "variacao":   variation,
            "ajuste":     self.data_cache.get("INFO_AJUSTE"),
            "volume":     self.data_cache.get("INFO_VOLUME"),
            "vwap":       self.data_cache.get("INFO_VWAP"),
        }
        
        return buys + sells, self.asset_name, last_price, variation, info

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
            history_already_read = True  # nao reler automaticamente
            last_ts_received = False
            last_historical_ts = 0
            sent_trades_buffer.clear()
            # Apaga os dados do banco de dados tambem
            try:
                session.post(f"{HTTP_PROTOCOL}://{SERVER_HOST}/api/trades/clear", timeout=10)
                print("[SISTEMA]: Banco de dados LIMPO com sucesso via reset.")
            except Exception as e:
                print(f"[SISTEMA]: Erro ao limpar banco: {e}")
            print("[SISTEMA]: Comando de RESET recebido. Memoria limpa.")
        elif t == 'RELOAD_HISTORY':
            # Botao "Montar Historico" pressionado no grafico
            history_already_read = False
            last_ts_received = True  # Nao precisa esperar o banco, ja sabemos o estado
            sent_trades_buffer.clear()
            print("[SISTEMA]: Comando RELOAD_HISTORY recebido. Relendo arquivo Historico...")
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

# Excel remanescente deletado

def process_time(val, now):
    try:
        if not val: return None, None
        ms = 0
        h, m, s = 0, 0, 0

        year, month, day = now.year, now.month, now.day
        has_explicit_date = False

        if isinstance(val, datetime.datetime):
            h, m, s, ms = val.hour, val.minute, val.second, val.microsecond // 1000
            if val.year > 2000:
                year, month, day = val.year, val.month, val.day
                has_explicit_date = True
        elif isinstance(val, (float, int)):
            # Formato Serial do Excel
            if val >= 1.0:
                excel_date = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=val)
                year, month, day = excel_date.year, excel_date.month, excel_date.day
                has_explicit_date = True
                
            seconds = int((val % 1) * 86400)
            h, m, s = (seconds // 3600) % 24, (seconds // 60) % 60, seconds % 60
        else:
            v_str = str(val).strip().replace(',', '.')
            if ' ' in v_str and '/' in v_str.split(' ')[0]:
                date_part = v_str.split(' ')[0]
                time_part = v_str.split(' ')[-1]
                dp = date_part.split('/')
                if len(dp) >= 3:
                    day, month, year = int(dp[0]), int(dp[1]), int(dp[2])
                    has_explicit_date = True
            else:
                time_part = v_str.split(' ')[-1] if ' ' in v_str else v_str
            
            if '.' in time_part:
                time_part, ms_str = time_part.split('.')
                ms = int(ms_str[:3].ljust(3, '0'))
            
            p = time_part.split(':')
            h = int(p[0])
            m = int(p[1]) if len(p) > 1 else 0
            s = int(p[2]) if len(p) > 2 else 0

        dt = now.replace(year=year, month=month, day=day, hour=h, minute=m, second=s, microsecond=ms * 1000)
        
        if not has_explicit_date:
            # Ajuste de Fuso Horário/Virada de Dia (APENAS se a data não vier do Excel)
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

def read_text_history(sent_buffer):
    """
    Lê o arquivo 'Historico' (texto/TSV)
    Mapping: 0=Horário, 2=Preço, 3=Quantidade, 5=Agressor
    """
    global history_already_read, last_history_uid
    
    try:
        import os
        
        file_path = None
        base_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(base_dir) # FOOTPRINT folder
        
        for name in ['Historico', 'Historico.txt', 'Historico.csv', 'candle.pontos']:
            p = os.path.join(parent_dir, name)
            if os.path.exists(p):
                file_path = p
                break
                
        if not file_path:
            print("[SISTEMA]: Arquivo 'Historico' não encontrado. Pressione F5 no terminal se estiver usando apenas tempo real.")
            history_already_read = True
            return
            
        print(f"[SISTEMA]: Lendo Histórico ultrarrápido do arquivo: {os.path.basename(file_path)}")
        
        is_full_sync = (last_historical_ts == 0)
        
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
            
        start_idx = 0
        for i, line in enumerate(lines[:10]):
            if line.strip() and line[0].isdigit():
                start_idx = i
                break
                
        data = []
        for line in lines[start_idx:]:
            if not line.strip(): continue
            parts = line.strip().split('\t')
            if len(parts) >= 6:
                data.append(parts)
        
        if not data: return
        
        hist_trades = []
        temp_last_uid = None
        now = datetime.datetime.now()
        ts_counters = {}
        
        for row in data:
            if not row[0] and not row[2] and not row[3] and not row[5]: break
            if not row[0] or not row[2] or not row[3]: continue
                
            ts, time_str = process_time(row[0], now)
            if not ts: continue
            
            if ts <= last_historical_ts: continue
                
            p = clean_price(row[2])
            q = int(float(str(row[3]).replace(',', '.')))
            side = normalize_side(row[5])
            
            base_id = f"{side}_{ts}_{p}_{q}"
            ts_counters[base_id] = ts_counters.get(base_id, 0) + 1
            uid = f"{base_id}_seq{ts_counters[base_id]}"
            
            if uid not in sent_buffer:
                hist_trades.append({"id": uid, "timestamp": ts, "price": p, "quantity": q, "side": side})
                sent_buffer.add(uid)
                temp_last_uid = uid
                
        if hist_trades:
            if is_full_sync:
                try: ws_client.send(json.dumps({"type": "START_HISTORY", "count": len(hist_trades)}))
                except: pass
                
            try:
                def send_batch(batch, index):
                    try:
                        session.post(POST_URL, json={"type": "NEW_DATA", "asset": "HISTORICO", "data": batch}, timeout=15)
                        if index > 0 and index % 4 == 0:
                            print(f"[SISTEMA]: Enviando histórico para a nuvem... {index * 5000} trades concluídos.")
                    except: pass

                with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
                    futures = []
                    batch_idx = 0
                    for i in range(0, len(hist_trades), 5000):
                        batch = hist_trades[i:i+5000]
                        futures.append(executor.submit(send_batch, batch, batch_idx))
                        batch_idx += 1
                    
                    concurrent.futures.wait(futures)
            finally:
                if is_full_sync:
                    # Pega o ultimo timestamp do arquivo para o server buscar o gap do RTD
                    last_file_ts = hist_trades[-1]['timestamp'] if hist_trades else 0
                    try: ws_client.send(json.dumps({"type": "END_HISTORY", "lastFileTs": last_file_ts}))
                    except: pass
                
            last_history_uid = temp_last_uid
            print(f"[SISTEMA]: Sincronização concluída. {len(hist_trades)} trades lidos do arquivo em milissegundos!")
        
        history_already_read = True
    except Exception as e:
        print(f"[ERRO HISTORICO TEXTO]: {e}")

def main():
    pythoncom.CoInitialize()
    global last_historical_ts, history_already_read, sent_trades_buffer, is_active
    print("--- ZENITH SCANNER V7.1.0: MOTOR DIRETO (SEM EXCEL) ---")
    threading.Thread(target=tx_worker, daemon=True).start()
    
    # Historico NAO e mais lido automaticamente ao ligar.
    # Ele so e carregado quando o usuario aperta o botao 'Montar Historico' no grafico.
    history_already_read = True
    
    rtd_client = None
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
                
                if historical_loaded:
                    print("[STATUS]: Motor em STANDBY. Limpando memória local...")
                    sent_trades_buffer.clear()
                    historical_loaded = False
                time.sleep(1)
                continue

            # Verifica se o usuario pediu para montar o historico (via botao)
            if not history_already_read and is_active:
                read_text_history(sent_trades_buffer)

            if not rtd_client:
                try:
                    rtd_client = DirectRTDClient()
                    rtd_client.connect()
                except Exception as e:
                    print(f"[RTD ERRO]: Falha ao conectar. Feche a BlackArrow e abra novamente se persistir. Erro: {e}")
                    time.sleep(5)
                    continue

            rtd_client.refresh()
            raw_trades, asset_name, current_price_raw, variation, info = rtd_client.get_trades()
            
            current_price = clean_price(current_price_raw) if current_price_raw else last_price_sent
            
            new_trades = []
            now = datetime.datetime.now()
            ts_counters = {}

            global history_requested
            for row in raw_trades:
                dt_str, p_val, q_val, side = row
                
                ts, time_str = process_time(dt_str, now)
                if ts and ts >= last_historical_ts:
                    p = clean_price(p_val)
                    try:
                        q = int(float(str(q_val).replace(',', '.')))
                    except:
                        q = 1
                    
                    base_id = f"{side}_{ts}_{p}_{q}"
                    ts_counters[base_id] = ts_counters.get(base_id, 0) + 1
                    uid = f"{base_id}_seq{ts_counters[base_id]}"
                    
                    if uid not in sent_trades_buffer:
                        new_trades.append({"id": uid, "timestamp": ts, "price": p, "quantity": q, "side": side})
                        sent_trades_buffer.add(uid)

            # Transmissao de Dados
            if new_trades or current_price != last_price_sent or variation != last_variation_sent:
                if new_trades:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] >>> ENVIANDO {len(new_trades)} NEGOCIOS | {asset_name} | {current_price} <<<")
                
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
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [VIVO] Motor: {status_motor} | Ativo: {asset_name} | ULT: {current_price} | VAR: {variation}%")
                    last_wait_log = time.time()

            time.sleep(SCAN_INTERVAL)
        except Exception as e:
            print(f"[RTD ERROR]: {e}")
            rtd_client = None
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
