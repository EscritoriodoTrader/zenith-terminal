import sys
import io
# Força UTF-8 no stdout/stderr para evitar crash com emojis no Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

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
LOCAL_SERVER = "127.0.0.1:3000"
REMOTE_SERVER = "zenith-terminal-bvj4.onrender.com"
SERVER_HOST = LOCAL_SERVER  # Voltar para local para evitar limite de banda do Render

# Detecta se é local ou remoto para o protocolo HTTP
HTTP_PROTOCOL = "http" if "localhost" in SERVER_HOST or "127.0.0.1" in SERVER_HOST else "https"
POST_URL = f"{HTTP_PROTOCOL}://{SERVER_HOST}/api/trades"
SCAN_INTERVAL = 0.5 # Aumentado para 500ms para garantir estabilidade absoluta no boot

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
is_active = True # Forçado como True para garantir fluxo imediato no boot
last_historical_ts = 0 

ws_client = None

history_requested = False
history_already_read = False
last_ts_received = False
sent_trades_buffer = set()
global_rtd_client = None

class DirectRTDClient:
    def __init__(self):
        self.rtd = None
        self.callback = None
        self.ExcelLib = None
        self.asset_name = "---"
        self.topics = {} 
        self.data_cache = {}
        self.max_tt_lines = 500
        self.next_tid = 5000          # IDs reservados para os canais de info
        
        # Estado por Canal (T&T0, T&T1)
        self.channels = ["T&T0", "T&T1"]
        self.channel_states = {
            "T&T0": {"info_subscribed": False, "last_known_asset": None},
            "T&T1": {"info_subscribed": False, "last_known_asset": None}
        }
        
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
        
        self._subscribe(1, ("T&T0", "INFO", "ATV"), "ASSET_NAME_T&T0")
        self._subscribe(2, ("T&T1", "INFO", "ATV"), "ASSET_NAME_T&T1")
        
        # T&T tem 500 trades por canal
        tid = 10
        for i in range(self.max_tt_lines):
            # Ativo 1 (T&T0)
            self._subscribe(tid, ("T&T0", "DAT", str(i)), f"T0_DAT_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "PRE", str(i)), f"T0_PRE_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "QUL", str(i)), f"T0_QUL_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "AGR", str(i)), f"T0_AGR_{i}"); tid+=1
            
            # Ativo 2 (T&T1)
            self._subscribe(tid, ("T&T1", "DAT", str(i)), f"T1_DAT_{i}"); tid+=1
            self._subscribe(tid, ("T&T1", "PRE", str(i)), f"T1_PRE_{i}"); tid+=1
            self._subscribe(tid, ("T&T1", "QUL", str(i)), f"T1_QUL_{i}"); tid+=1
            self._subscribe(tid, ("T&T1", "AGR", str(i)), f"T1_AGR_{i}"); tid+=1
        
        print(f"[RTD DIRETO]: {tid} canais assinados (500 trades por ativo).")
        
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
            # Verifica nomes dos ativos nos dados iniciais
            for chan in self.channels:
                raw_name = self.data_cache.get(f"ASSET_NAME_{chan}", "")
                if raw_name and str(raw_name).strip() not in ("", "---", "None"):
                    new_name = str(raw_name).strip()
                    print(f"[RTD DIRETO]: Ativo detectado em {chan}: {new_name}")
                    self._subscribe_info(new_name, chan)
                    self.channel_states[chan]["last_known_asset"] = new_name
        except Exception as e:
            print(f"[RTD DIRETO]: Aviso na leitura inicial: {e}")

    def _subscribe_info(self, symbol, channel):
        """Assina os canais informativos com IDs únicos por canal para evitar mistura"""
        info_symbol = symbol if "_M_" in symbol else f"{symbol}_M_0"
        
        # Define um range de IDs fixo por canal para isolamento total
        # T&T0 -> 5000+, T&T1 -> 6000+, T&T2 -> 7000+, etc.
        chan_idx = self.channels.index(channel) if channel in self.channels else 0
        base_tid = 5000 + (chan_idx * 1000)
        
        print(f"[RTD DIRETO]: [{channel}] Assinando {symbol} (Tópico: {info_symbol}) no range {base_tid}")
        
        tid = base_tid
        self._subscribe(tid, (info_symbol, "ULT"), f"ULT_{symbol}_{channel}");   tid += 1
        self._subscribe(tid, (info_symbol, "ABE"), f"ABE_{symbol}_{channel}");   tid += 1
        self._subscribe(tid, (info_symbol, "MAX"), f"MAX_{symbol}_{channel}");   tid += 1
        self._subscribe(tid, (info_symbol, "MIN"), f"MIN_{symbol}_{channel}");   tid += 1
        self._subscribe(tid, (info_symbol, "FEC"), f"FEC_{symbol}_{channel}");   tid += 1
        self._subscribe(tid, (info_symbol, "VAR"), f"VAR_{symbol}_{channel}");   tid += 1
        self._subscribe(tid, (info_symbol, "AJA"), f"AJA_{symbol}_{channel}");   tid += 1
        self._subscribe(tid, (info_symbol, "100"), f"VOL_{symbol}_{channel}");   tid += 1
        self._subscribe(tid, (info_symbol, "67"),  f"VWP_{symbol}_{channel}");   tid += 1
        
        self.channel_states[channel]["info_subscribed"] = True
        self.channel_states[channel]["last_known_asset"] = symbol

    def add_channel(self, channel_name):
        """Adiciona dinamicamente um novo canal T&T (ex: T&T2)"""
        if channel_name in self.channels: return
        print(f"[RTD DIRETO]: Adicionando novo canal: {channel_name}")
        self.channels.append(channel_name)
        self.channel_states[channel_name] = {"info_subscribed": False, "last_known_asset": None}
        
        # Assina o nome do ativo para este canal
        tid_name = len(self.topics) + 100 # Offset seguro
        self._subscribe(tid_name, (channel_name, "INFO", "ATV"), f"ASSET_NAME_{channel_name}")
        
        # Assina os 500 trades iniciais
        tid = 10000 + (len(self.channels) * 2000) # Offset para novos canais
        for i in range(self.max_tt_lines):
            self._subscribe(tid, (channel_name, "DAT", str(i)), f"{channel_name}_DAT_{i}"); tid+=1
            self._subscribe(tid, (channel_name, "PRE", str(i)), f"{channel_name}_PRE_{i}"); tid+=1
            self._subscribe(tid, (channel_name, "QUL", str(i)), f"{channel_name}_QUL_{i}"); tid+=1
            self._subscribe(tid, (channel_name, "AGR", str(i)), f"{channel_name}_AGR_{i}"); tid+=1
        print(f"[RTD DIRETO]: Canal {channel_name} configurado.")
        
    def _subscribe(self, topic_id, args, internal_name):
        try:
            self.rtd.ConnectData(topic_id, args, True)
            self.topics[topic_id] = internal_name
        except Exception:
            pass
            
    def _unsubscribe_info(self, channel):
        """Cancela assinatura dos canais informativos do ativo anterior no canal especificado"""
        info_prefixes = ["ULT_", "ABE_", "MAX_", "MIN_", "FEC_", "VAR_", "AJA_", "VOL_", "VWP_"]
        keys_to_remove = [p + channel for p in info_prefixes]
        
        for key in keys_to_remove:
            self.data_cache.pop(key, None)
        
        # Cancela as inscricoes pelo reverse lookup de topics
        tids_to_remove = [tid for tid, name in self.topics.items() if name in keys_to_remove]
        for tid in tids_to_remove:
            try: self.rtd.DisconnectData(tid)
            except: pass
            del self.topics[tid]
        
        self.channel_states[channel]["info_subscribed"] = False

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
            
            # Sincroniza estados dos canais (Ativo 1 e Ativo 2)
            for chan in self.channels:
                state = self.channel_states[chan]
                raw_name = self.data_cache.get(f"ASSET_NAME_{chan}", "")
                
                # Força o nome do ativo conforme seu arquivo RTD
                new_name = str(raw_name).strip() if raw_name else ""
                if not new_name or new_name == "---":
                    new_name = "ESM6" if chan == "T&T0" else "NQM6"

                if not state["info_subscribed"] or new_name != state["last_known_asset"]:
                    if state["info_subscribed"]:
                        print(f"[RTD DIRETO]: Mudança de Ativo no {chan}: {state['last_known_asset']} -> {new_name}")
                        self._unsubscribe_info(chan)
                        time.sleep(0.05) 
                    
                    self._subscribe_info(new_name, chan)
                    state["last_known_asset"] = new_name
            return True
        return False
        
    def get_all_assets_data(self):
        """Retorna uma lista de dados para cada ativo (canal) monitorado"""
        updates = []
        for idx, chan in enumerate(self.channels):
            trades = []
            # Prefixo dinâmico baseado no nome do canal
            # Para T&T0/T&T1 mantemos compatibilidade T0_/T1_
            if chan == "T&T0": prefix = "T0_"
            elif chan == "T&T1": prefix = "T1_"
            else: prefix = f"{chan}_"
            
            for i in range(self.max_tt_lines):
                dt = self.data_cache.get(f"{prefix}DAT_{i}")
                pr = self.data_cache.get(f"{prefix}PRE_{i}")
                qt = self.data_cache.get(f"{prefix}QUL_{i}")
                ag = self.data_cache.get(f"{prefix}AGR_{i}")
                
                if dt and pr and qt:
                    ag_val = str(ag).strip().upper() if ag else ""
                    # Lógica de agressão: BlackArrow AGR costuma ter 'VEND' para SELL e 'COMPR' para BUY
                    if "VEND" in ag_val or "S" in ag_val: side = "SELL"
                    else: side = "BUY"
                    trades.append((dt, pr, qt, side))
            
            asset_name = str(self.data_cache.get(f"ASSET_NAME_{chan}", "---"))
            
            # Busca os dados usando a chave única (Ativo + Canal) para evitar mistura
            last_price = clean_price(self.data_cache.get(f"ULT_{asset_name}_{chan}", 0)) or 0
            
            # Se não tem último preço na info, tenta o primeiro trade
            if not last_price and trades:
                last_price = clean_price(trades[0][1])
                
            variation = clean_variation(self.data_cache.get(f"VAR_{asset_name}_{chan}", 0)) or 0
            
            info = {
                "ultimo":     self.data_cache.get(f"ULT_{asset_name}_{chan}"),
                "abertura":   self.data_cache.get(f"ABE_{asset_name}_{chan}"),
                "maxima":     self.data_cache.get(f"MAX_{asset_name}_{chan}"),
                "minima":     self.data_cache.get(f"MIN_{asset_name}_{chan}"),
                "fechamento": self.data_cache.get(f"FEC_{asset_name}_{chan}"),
                "variacao":   variation,
                "ajuste":     self.data_cache.get(f"AJA_{asset_name}_{chan}"),
                "volume":     self.data_cache.get(f"VOL_{asset_name}_{chan}"),
                "vwap":       self.data_cache.get(f"VWP_{asset_name}_{chan}"),
            }
            
            updates.append({
                "channel": chan, # Inclui o nome do canal (T&T0, T&T1, etc)
                "trades": trades,
                "asset_name": asset_name,
                "last_price": last_price,
                "variation": variation,
                "info": info
            })
        return updates

def on_message(ws, message):
    global is_active, ws_client, history_requested, history_already_read, sent_trades_buffer
    ws_client = ws
    try:
        msg = json.loads(message)
        t = msg.get('type')
        if t in ['MOTOR_STATUS', 'TOGGLE_MOTOR']:
            is_active = msg.get('running', False)
            print(f"[COMANDO]: Motor {'LIGADO' if is_active else 'DESLIGADO'}")
        elif t == 'CHANGE_ASSET':
            chan = msg.get('channel')
            asset = msg.get('asset')
            print(f"[COMANDO]: Troca de Ativo solicitada para {chan} -> {asset}")
            # Se for um canal novo que não conhecemos, adicionamos
            if chan and "T&T" in chan:
                # O motor Python avisa o RTD para olhar esse novo canal de Times & Trades
                # Nota: O usuário deve ter uma janela com esse nome aberta no BlackArrow
                if global_rtd_client:
                    global_rtd_client.add_channel(chan)
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
                        "channel": payload.get("channel", "T&T0"),
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
        
        # Tenta descobrir o ativo principal para o histórico
        asset_name = "HIST"
        if global_rtd_client:
            raw_n = global_rtd_client.data_cache.get("ASSET_NAME_T&T0", "")
            if raw_n and raw_n != "---":
                asset_name = str(raw_n).strip()
        
        for row in data:
            if not row[0] and not row[2] and not row[3] and not row[5]: break
            if not row[0] or not row[2] or not row[3]: continue
                
            ts, time_str = process_time(row[0], now)
            if not ts: continue
            
            if ts <= last_historical_ts: continue
                
            p = clean_price(row[2])
            q = int(float(str(row[3]).replace(',', '.')))
            side = normalize_side(row[5])
            
            # O ID agora inclui o nome do ativo para evitar colisao entre ativos diferentes (Multi-Ativo)
            base_id = f"{asset_name}_{side}_{ts}_{p}_{q}"
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
                        # Log de histórico removido para manter o terminal limpo
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
    print("--- ZENITH MARKET-DATA V7.1.0: MOTOR DIRETO (SEM EXCEL) ---")
    threading.Thread(target=tx_worker, daemon=True).start()
    
    # Historico NAO e mais lido automaticamente ao ligar.
    # Ele so e carregado quando o usuario aperta o botao 'Montar Historico' no grafico.
    history_already_read = True
    
    rtd_client = None
    global global_rtd_client
    last_prices_sent = {}
    last_variations_sent = {}
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
                    global_rtd_client = rtd_client
                except Exception as e:
                    print(f"[RTD ERRO]: Falha ao conectar. Feche a BlackArrow e abra novamente se persistir. Erro: {e}")
                    time.sleep(5)
                    continue

            rtd_client.refresh()
            asset_updates = rtd_client.get_all_assets_data()
            
            for update in asset_updates:
                chan = update["channel"]
                raw_trades = update["trades"]
                asset_name = update["asset_name"]
                current_price = update["last_price"]
                variation = update["variation"]
                
                if asset_name == "---" or not asset_name:
                    continue

                new_trades = []
                now = datetime.datetime.now()
                ts_counters = {}

                for row in raw_trades:
                    dt_str, p_val, q_val, side = row
                    ts, time_str = process_time(dt_str, now)
                    if ts and ts >= last_historical_ts:
                        p = clean_price(p_val)
                        try: q = int(float(str(q_val).replace(',', '.')))
                        except: q = 1
                        
                        # O ID agora inclui o nome do ativo para isolamento total no banco de dados
                        base_id = f"{asset_name}_{side}_{ts}_{p}_{q}"
                        ts_counters[base_id] = ts_counters.get(base_id, 0) + 1
                        uid = f"{base_id}_seq{ts_counters[base_id]}"
                        
                        if uid not in sent_trades_buffer:
                            new_trades.append({"id": uid, "timestamp": ts, "price": p, "quantity": q, "side": side})
                            sent_trades_buffer.add(uid)

                # Transmissao de Dados
                last_p = last_prices_sent.get(asset_name, 0)
                last_v = last_variations_sent.get(asset_name, -999)

                if new_trades or current_price != last_p or variation != last_v:
                    # Log de Informativos (RTD) no Terminal
                    info = update.get("info", {})
                    max_val = info.get("maxima", 0)
                    min_val = info.get("minima", 0)
                    vol_val = info.get("volume", 0)
                    vwap_val = info.get("vwap", 0)
                    
                    # Formata volume
                    try: 
                        v_num = float(vol_val)
                        v_str = f"{v_num/1000:.1f}K" if v_num >= 1000 else str(v_num)
                    except: v_str = str(vol_val)

                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [{asset_name}] Preço: {current_price} | MAX: {max_val} | MIN: {min_val} | VOL: {v_str} | VWAP: {vwap_val} | VAR: {variation:+.2f}%")
                    
                    if new_trades: new_trades.sort(key=lambda x: x['timestamp'])
                    
                    tx_queue.put({
                        "type": "NEW_DATA",
                        "channel": chan, # Identificador crucial para o frontend
                        "asset": asset_name,
                        "data": new_trades, 
                        "lastPrice": current_price, 
                        "variation": variation
                    })
                    last_prices_sent[asset_name] = current_price
                    last_variations_sent[asset_name] = variation

            # Log de status removido para manter o terminal limpo conforme pedido


            time.sleep(SCAN_INTERVAL)
        except Exception as e:
            print(f"[RTD ERROR]: {e}")
            rtd_client = None
            time.sleep(1)

if __name__ == "__main__":
    while True:
        try:
            print("\n" + "="*50)
            print("[ZENITH] MARKET-DATA V6.0: MOTOR DE ALTA RESILIENCIA")
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
