import sys
import io

# Wrappers temporariamente removidos para debug

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
import collections
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
SCAN_INTERVAL = 0.0  # MUDANÇA: Rodar na velocidade máxima possível para testar fila do RTD

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
audit_queue = queue.Queue()

def audit_worker():
    import os
    log_dir = os.path.join(os.path.dirname(__file__), "..", "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "rtd_audit.log")
    while True:
        try:
            msg = audit_queue.get()
            if msg is None: break
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(msg)
            audit_queue.task_done()
        except Exception:
            pass

threading.Thread(target=audit_worker, daemon=True).start()

session = requests.Session()
is_active = True # Forçado como True para garantir fluxo imediato no boot
last_historical_ts = 0 

ws_client = None
ws_connected = False  # Trava: impede múltiplas conexões simultâneas

history_requested = False
history_already_read = False
last_ts_received = False
sent_trades_buffer = set()
pending_channels_to_add = queue.Queue()


class DirectRTDClient:
    def __init__(self):
        self.rtd = None
        self.callback = None
        self.ExcelLib = None
        self.asset_name = "---"
        self.topics = {} 
        self.data_cache = {}
        # Trava de Segurança: A Nelogica limita a 500 linhas úteis.
        # Ler mais que isso traz trades clonados em loop infinito (max_dupe_ms=1500).
        self.max_tt_lines = 500
        
        self.audit_stats = {
            "T&T0": {"reads": 0, "refreshes": 0, "new_trades": 0, "max_K": 0, "overflows": 0}
        } 
        
        # Conexão COM e filasnal
        self.next_tid = 10000         # IDs reservados para os canais de info
        
        # Estado por Canal
        self.channels = ["T&T0"]
        self.channel_states = {
            "T&T0": {"info_subscribed": False, "last_known_asset": None}
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
        self.callback._HeartbeatInterval = 1  # 1ms: força push contínuo do RTD
        self.rtd.ServerStart(self.callback)
        print("[RTD DIRETO]: Conexão estabelecida! Assinando canais...")
        
        self._subscribe(1, ("T&T0", "INFO", "ATV"), "ASSET_NAME_T&T0")
        
        # T&T tem 500 trades por canal
        tid = 10
        for i in range(self.max_tt_lines):
            # Ativo 1 (T&T0)
            self._subscribe(tid, ("T&T0", "DAT", str(i)), f"T0_DAT_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "ACP", str(i)), f"T0_ACP_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "PRE", str(i)), f"T0_PRE_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "QUL", str(i)), f"T0_QUL_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "AVD", str(i)), f"T0_AVD_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "AGR", str(i)), f"T0_AGR_{i}"); tid+=1
            self._subscribe(tid, ("T&T0", "AGAG", str(i)), f"T0_AGAG_{i}"); tid+=1
        
        print(f"[RTD DIRETO]: {tid} canais assinados (500 trades por ativo).")
        
        # Forca uma primeira leitura imediata para pegar os valores iniciais
        # sem depender do callback UpdateNotify
        time.sleep(0.5)  # Aguarda o servidor processar todas as assinaturas
        self._force_refresh()

    def disconnect(self):
        """Termina a conexão COM com o servidor RTD para evitar conexões fantasmas."""
        print("[RTD DIRETO]: Encerrando conexão RTD com a BlackArrow...")
        if self.rtd:
            try:
                self.rtd.ServerTerminate()
            except Exception as e:
                print(f"[RTD DIRETO ERROR]: Falha ao chamar ServerTerminate: {e}")
            self.rtd = None
        self.callback = None


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
        """Assina apenas os tópicos cruciais (Último e Variação) com IDs únicos por canal"""
        info_symbol = symbol
        
        # Use and increment the unique COM topic ID pointer to bypass COM server topic caching bugs
        ult_tid = self.next_tid; self.next_tid += 1
        var_tid = self.next_tid; self.next_tid += 1
        
        print(f"[RTD DIRETO]: [{channel}] Assinando {symbol} com IDs únicos ULT:{ult_tid}, VAR:{var_tid}")
        
        self._subscribe(ult_tid, (info_symbol, "ULT"), f"ULT_{symbol}_{channel}")
        self._subscribe(var_tid, (info_symbol, "VAR"), f"VAR_{symbol}_{channel}")
        
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
        """Cancela assinatura dos canais informativos do ativo anterior no canal especificado e limpa o cache de trades"""
        info_prefixes = ["ULT_", "VAR_"]
        
        # Coleta todas as chaves e tópicos dinamicamente que terminam com o canal
        keys_to_remove = []
        for key in list(self.data_cache.keys()):
            for prefix in info_prefixes:
                if key.startswith(prefix) and key.endswith(f"_{channel}"):
                    keys_to_remove.append(key)
                    self.data_cache.pop(key, None)
                    break
                    
        # Cancela as inscricoes pelo reverse lookup de topics
        tids_to_remove = []
        for tid, name in list(self.topics.items()):
            for prefix in info_prefixes:
                if name.startswith(prefix) and name.endswith(f"_{channel}"):
                    tids_to_remove.append(tid)
                    break
                    
        for tid in tids_to_remove:
            try: self.rtd.DisconnectData(tid)
            except: pass
            self.topics.pop(tid, None)
        
        # --- FLUSH DE MEMÓRIA CRUCIAL ---
        # Limpa todos os 500 trades antigos deste canal para evitar mistura de dados antigos
        prefix = "T0_" if channel == "T&T0" else "T1_" if channel == "T&T1" else f"{channel}_"
        for i in range(self.max_tt_lines):
            self.data_cache.pop(f"{prefix}DAT_{i}", None)
            self.data_cache.pop(f"{prefix}PRE_{i}", None)
            self.data_cache.pop(f"{prefix}QUL_{i}", None)
            self.data_cache.pop(f"{prefix}AGR_{i}", None)
            self.data_cache.pop(f"{prefix}ACP_{i}", None)
            self.data_cache.pop(f"{prefix}AVD_{i}", None)
            self.data_cache.pop(f"{prefix}AGAG_{i}", None)
        print(f"[RTD DIRETO]: [{channel}] Cache de informativos e trades limpo com sucesso.")
        
        self.channel_states[channel]["info_subscribed"] = False

    def refresh(self):
        import pythoncom
        
        # Processa novos canais pendentes no início do refresh (Thread-safe COM)
        while not pending_channels_to_add.empty():
            try:
                chan_to_add = pending_channels_to_add.get_nowait()
                self.add_channel(chan_to_add)
                pending_channels_to_add.task_done()
            except queue.Empty:
                break
            except Exception as ex:
                print(f"[RTD ERROR] Falha ao adicionar canal {chan_to_add}: {ex}")

        # MODO IMEDIATO — leitura sem delay
        # Justificativa: a 244 t/s (pico observado), a janela de 500 slots
        # se esgota em ~2s. Qualquer espera (150ms ou 5s) causa overflow.
        # Python lê RefreshData() a cada ciclo do main loop (~10ms via SCAN_INTERVAL),
        # garantindo captura antes que a janela gire.
        # PumpWaitingMessages() processa eventos COM pendentes (incluindo UpdateNotify)
        # de forma não-bloqueante, garantindo que a fila COM nunca acumule.
        pythoncom.PumpWaitingMessages()

        # Processa novos canais pendentes
        while not pending_channels_to_add.empty():
            try:
                chan_to_add = pending_channels_to_add.get_nowait()
                self.add_channel(chan_to_add)
                pending_channels_to_add.task_done()
            except queue.Empty:
                break
            except Exception as ex:
                print(f"[RTD ERROR] Falha ao adicionar canal {chan_to_add}: {ex}")

        self.callback.has_updates = False
        
        # Agora sim puxamos a água, porque temos certeza absoluta que o Profit empurrou
        import time as _t
        _t0 = _t.time()
        pythoncom.PumpWaitingMessages()
        _t1 = _t.time()
        result = self.rtd.RefreshData(0)
        _t2 = _t.time()
        
        if (_t1 - _t0) > 0.05:
            print(f"[GARGALO COM]: PumpWaitingMessages demorou {(_t1-_t0)*1000:.1f}ms!")
        if (_t2 - _t1) > 0.05:
            print(f"[GARGALO PROFIT]: RefreshData demorou {(_t2-_t1)*1000:.1f}ms! (O Profit congelou)")

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
                if not new_name or new_name == "---" or new_name.startswith("T&T"):
                    new_name = "WINFUT"

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
        # DEBUG: Log RAW CACHE removido para focar 100% no motor de RTD
        debug_cache = {k: v for k, v in self.data_cache.items() if "ASSET_NAME" in k or "ULT" in k or "VAR" in k}
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
                acp = self.data_cache.get(f"{prefix}ACP_{i}")
                pr = self.data_cache.get(f"{prefix}PRE_{i}")
                qt = self.data_cache.get(f"{prefix}QUL_{i}")
                avd = self.data_cache.get(f"{prefix}AVD_{i}")
                ag = self.data_cache.get(f"{prefix}AGR_{i}")
                
                # Proteção contra Data Tearing: Exige que a coluna de Agressor esteja preenchida
                if dt is not None and pr is not None and qt is not None and ag is not None:
                    # DESCARTA LIXO ANTES DA DEDUPLICAÇÃO
                    dt_str = str(dt).strip()
                    if not dt_str or dt_str in ("---", "-", "None") or "Inv" in dt_str:
                        continue

                    ag_val = str(ag).strip().upper()
                    if not ag_val or ag_val in ("---", "0", "NONE"): 
                        side = "UNKNOWN"
                    elif "VEND" in ag_val or "S" in ag_val: 
                        side = "SELL"
                    elif "COMP" in ag_val or "C" in ag_val:
                        side = "BUY"
                    else: 
                        side = "UNKNOWN"
                    
                    acp_str = str(acp).strip()
                    avd_str = str(avd).strip()
                    normalized_asset = self.channel_states[chan].get("last_known_asset", "WINFUT")
                    trades.append((dt_str, pr, qt, side, acp_str, avd_str))
            
            # ══════════════════════════════════════════════════════════════
            # AUDIT LOGGER 5s REMOVIDO PARA FOCO TOTAL NO MOTOR
            # Apenas Overflows Reais serão logados imediatamente via fila assíncrona
            # ══════════════════════════════════════════════════════════════
            
            asset_name = self.channel_states[chan].get("last_known_asset")
            if not asset_name or asset_name == "---":
                asset_name = "WINFUT"
                self.channel_states[chan]["last_known_asset"] = asset_name

            if not trades:
                # O usuário pediu para NÃO gerar dados falsos (random)
                # Apenas mantemos o último preço e variação do RTD
                last_price = clean_price(self.data_cache.get(f"ULT_{asset_name}_{chan}", 0), asset_name) or 0
                variation = clean_variation(self.data_cache.get(f"VAR_{asset_name}_{chan}", 0)) or 0
            else:
                # Busca os dados usando a chave única (Ativo + Canal) para evitar mistura
                last_price = clean_price(self.data_cache.get(f"ULT_{asset_name}_{chan}", 0), asset_name) or 0
                
                # Se não tem último preço na info, tenta o primeiro trade
                if not last_price and trades:
                    last_price = clean_price(trades[0][1], asset_name)
                    
                variation = clean_variation(self.data_cache.get(f"VAR_{asset_name}_{chan}", 0)) or 0

            # Validação Cruzada de Segurança contra vazamento do RTD por Faixa de Preço
            is_nq = "NQ" in asset_name.upper()
            is_es = "ES" in asset_name.upper()
            if is_nq and last_price > 0 and last_price < 12000:
                last_price = 0
                variation = 0
                trades = []
            elif is_es and last_price > 12000:
                last_price = 0
                variation = 0
                trades = []
            
            info = {
                "ultimo":     self.data_cache.get(f"ULT_{asset_name}_{chan}"),
                "abertura":   None,
                "maxima":     None,
                "minima":     None,
                "fechamento": None,
                "variacao":   variation,
                "ajuste":     None,
                "volume":     None,
                "vwap":       None,
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

import random

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
                # Enfileira para processamento na thread principal de COM
                pending_channels_to_add.put(chan)

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
            history_already_read = True
            sent_trades_buffer.clear()
            print("[SISTEMA]: Comando RELOAD_HISTORY recebido. Memória de duplicados do tempo real resetada.")
        elif t == 'SHUTDOWN':
            print("[SISTEMA]: Encerrando motor por comando remoto...")
            import os
            os._exit(0)
    except: pass

def start_ws():
    def run():
        global ws_client, ws_connected
        print(f"[WS]: Iniciando conexão com o servidor em {SERVER_HOST}...")
        retry_delay = 2  # Backoff inicial em segundos

        def on_open(ws):
            global ws_client, ws_connected, retry_delay
            ws_client = ws
            ws_connected = True
            retry_delay = 2  # Reseta o backoff após conexão bem-sucedida
            print(f"[WS]: Túnel de dados CONECTADO em {ws_url}")
            try:
                ws.send(json.dumps({"type": "PING", "origin": "PYTHON_MOTOR"}))
                ws.send(json.dumps({"type": "PYTHON_CONNECT"}))
                ws.send(json.dumps({"type": "GET_LAST_TS"}))
            except: pass

        def on_close(ws, code, msg):
            global ws_client, ws_connected
            ws_connected = False
            ws_client = None
            print(f"[WS]: Conexão encerrada (código={code}). Aguardando {retry_delay}s para reconectar...")

        def on_error(ws, error):
            global ws_connected
            ws_connected = False
            print(f"[WS]: Erro na conexão: {error}")

        while True:
            # Só reconecta se não há conexão ativa
            if ws_connected:
                time.sleep(1)
                continue
            try:
                protocol = "ws" if "localhost" in SERVER_HOST or "127.0.0.1" in SERVER_HOST else "wss"
                ws_url = f"{protocol}://{SERVER_HOST}"

                # Fecha conexão antiga explicitamente antes de criar nova
                if ws_client:
                    try: ws_client.close()
                    except: pass

                ws = websocket.WebSocketApp(
                    ws_url,
                    on_message=on_message,
                    on_open=on_open,
                    on_close=on_close,
                    on_error=on_error
                )
                ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                print(f"[WS]: Exceção inesperada: {e}")
            finally:
                ws_connected = False
            # Backoff exponencial: 2s → 4s → 8s → máx 30s
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 30)

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


import functools

@functools.lru_cache(maxsize=8192)
def _parse_time_cached(val_str, year, month, day, h_base):
    try:
        v_str = str(val_str).strip().replace(',', '.')
        has_explicit_date = False
        
        if ' ' in v_str and '/' in v_str.split(' ')[0]:
            date_part = v_str.split(' ')[0]
            time_part = v_str.split(' ')[-1]
            dp = date_part.split('/')
            if len(dp) >= 3:
                day, month, year = int(dp[0]), int(dp[1]), int(dp[2])
                has_explicit_date = True
        else:
            time_part = v_str.split(' ')[-1] if ' ' in v_str else v_str
        
        ms = 0
        if '.' in time_part:
            time_part, ms_str = time_part.split('.')
            ms = int(ms_str[:3].ljust(3, '0'))
        
        p = time_part.split(':')
        h = int(p[0])
        m = int(p[1]) if len(p) > 1 else 0
        s = int(p[2]) if len(p) > 2 else 0

        dt = datetime.datetime(year=year, month=month, day=day, hour=h, minute=m, second=s, microsecond=ms * 1000)
        
        if not has_explicit_date:
            # Ajuste de Fuso Horário/Virada de Dia (APENAS se a data não vier do Excel)
            now_base = datetime.datetime(year=year, month=month, day=day, hour=h_base, minute=0, second=0)
            if dt > now_base + datetime.timedelta(hours=2): 
                dt -= datetime.timedelta(days=1)
            
        return int(dt.timestamp() * 1000), dt.strftime('%H:%M:%S.%f')[:-3]
    except Exception as e:
        return None, None

def process_time(val, now):
    if not val: return None, None
    try:
        if isinstance(val, datetime.datetime):
            h, m, s, ms = val.hour, val.minute, val.second, val.microsecond // 1000
            year, month, day = val.year, val.month, val.day
            dt = now.replace(year=year, month=month, day=day, hour=h, minute=m, second=s, microsecond=ms * 1000)
            return int(dt.timestamp() * 1000), dt.strftime('%H:%M:%S')
        elif isinstance(val, (float, int)):
            total_ms = int(round((val % 1) * 86400000))
            h = (total_ms // 3600000) % 24
            m = (total_ms // 60000) % 60
            s = (total_ms // 1000) % 60
            ms = total_ms % 1000
            dt = now.replace(hour=h, minute=m, second=s, microsecond=ms * 1000)
            return int(dt.timestamp() * 1000), dt.strftime('%H:%M:%S.%f')[:-3]
        else:
            return _parse_time_cached(str(val), now.year, now.month, now.day, now.hour)
    except Exception as e:
        return None, None

def clean_price(val, asset_name=None):
    try:
        if isinstance(val, (float, int)): 
            n = float(val)
        else:
            s = str(val).strip().replace(' ', '')
            if ',' in s and '.' in s: s = s.replace('.', '').replace(',', '.')
            elif ',' in s: s = s.replace(',', '.')
            n = float(s)
        
        # AJUSTE NASDAC / S&P500 se o número vier sem ponto (muito grande, ex: > 100000)
        # Aplicamos APENAS para ativos americanos (NQ, ES) para não corromper os índices da B3 (WIN, IND)
        if asset_name:
            an = asset_name.upper()
            if ("NQ" in an or "ES" in an) and n > 100000:
                n = n / 100.0
        elif n > 200000: # Fallback genérico alto para não colidir com o WIN (110k-130k)
            n = n / 100.0
        return n
    except: return 0.0

def clean_quantity(val):
    try:
        if isinstance(val, (int, float)):
            return int(val)
        s = str(val).strip().replace(' ', '')
        if not s: return 1
        if ',' in s and '.' in s:
            s = s.replace('.', '').replace(',', '.')
        elif ',' in s:
            parts = s.split(',')
            if len(parts[-1]) == 3:
                s = s.replace(',', '')
            else:
                s = s.replace(',', '.')
        elif '.' in s:
            parts = s.split('.')
            if len(parts[-1]) == 3:
                s = s.replace('.', '')
        return int(float(s))
    except:
        return 1

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

# O motor real-time não lê mais histórico de arquivos diretamente.
# A importação do histórico agora é de responsabilidade exclusiva do script Historico.py

tx_worker_started = False

def start_tx_worker():
    global tx_worker_started
    if not tx_worker_started:
        threading.Thread(target=tx_worker, daemon=True).start()
        tx_worker_started = True

def main():
    pythoncom.CoInitialize()
    global last_historical_ts, history_already_read, sent_trades_buffer, is_active
    print("--- ZENITH MARKET-DATA V7.2.0: MOTOR DIRETO (SEM EXCEL) ---")
    start_tx_worker()

    
    # Historico NAO e mais lido automaticamente ao ligar.
    # Ele so e carregado quando o usuario aperta o botao 'Montar Historico' no grafico.
    history_already_read = True
    
    rtd_client = None
    last_prices_sent = {}
    last_variations_sent = {}
    historical_loaded = False

    
    # Algoritmo Maximum Alignment Shift Detection
    # Guarda a última janela de 500 linhas para encontrar o deslocamento exato.
    last_window_per_chan = {}
    last_shift_audit_time = {}
    
    # Cache de contagens para gerar UIDs sequenciais únicos (seq1, seq2...)
    sent_counts_per_chan = {}

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

            # O histórico agora é montado pelo script standalone Historico.py disparado pelo Node
            if not history_already_read:
                history_already_read = True

            if not rtd_client:
                try:
                    rtd_client = DirectRTDClient()
                    rtd_client.connect()
                except Exception as e:
                    print(f"[RTD STATUS]: Aguardando BlackArrow ser iniciada para conectar (Tentando novamente em 3s)...")
                    rtd_client = None
                    time.sleep(3)
                    continue


            rtd_client.refresh()
            asset_updates = rtd_client.get_all_assets_data()
            
            # Dicionários para agrupar trades e informações por ativo (suporte a múltiplas janelas do mesmo ativo)
            grouped_trades = {}
            grouped_info = {}

            for update in asset_updates:
                chan = update["channel"]
                raw_trades = update["trades"]
                asset_name = update["asset_name"]
                current_price = update["last_price"]
                variation = update["variation"]
                
                if asset_name == "---" or not asset_name:
                    continue

                # Normalização do Ativo (Multi-Ativo B3 e Americano unificados)
                normalized_asset = asset_name.upper().strip()
                if normalized_asset.startswith("WIN") or normalized_asset.startswith("IND"):
                    normalized_asset = "WINFUT"
                elif normalized_asset.startswith("WDO") or normalized_asset.startswith("DOL"):
                    normalized_asset = "WDOFUT"
                elif "NQ" in normalized_asset:
                    normalized_asset = "NQM6"
                elif "ES" in normalized_asset:
                    normalized_asset = "ESM6"

                # ---------------------------------------------------------
                # ALGORITMO: Rastreamento por Âncora de Posição (v2)
                # ---------------------------------------------------------
                # Problema do algoritmo anterior: em HFT, múltiplos trades têm
                # a mesma chave (ts, price, qty, side). A comparação por 50%
                # de sobreposição escolhia o shift errado — ora perdendo trades,
                # ora duplicando.
                #
                # Nova abordagem DETERMINÍSTICA:
                # O T&T é uma janela FIFO de 500 linhas. O trade mais recente
                # que já enviamos estava em alguma posição da janela anterior.
                # Na nova janela, ele desceu exatamente K posições (K = novos trades
                # que entraram). Buscamos a âncora (primeiro trade da janela antiga)
                # na nova janela para achar K sem ambiguidade.
                #
                # Para trades idênticos: usamos O ÍNDICE SEQUENCIAL da janela
                # como desempate. Se a nova janela tem N trades idênticos onde
                # a antiga tinha M, (N-M) deles são novos (entraram no topo).
                # ---------------------------------------------------------

                now = datetime.datetime.now()
                new_window = []

                for row in raw_trades:
                    dt_str, p_val, q_val, side, acp_str, avd_str = row

                    ts, time_str = process_time(dt_str, now)
                    if not ts or ts < 1577836800000 or ts <= last_historical_ts:
                        continue

                    # Removido early exit por timestamp para garantir a visão completa da janela
                    pass

                    p = clean_price(p_val, normalized_asset)
                    q = clean_quantity(q_val)
                    if not p or not q:
                        continue

                    # Enviamos em formato RAW array para o Node.js 
                    # em vez de dicionários com chaves
                    new_window.append([ts, p, q, side, acp_str, avd_str])

                if not hasattr(rtd_client, 'last_windows'):
                    rtd_client.last_windows = {"T&T0": []}
                    rtd_client.total_reads = {"T&T0": 0}
                    rtd_client.total_refreshes = {"T&T0": 0}

                old_window = rtd_client.last_windows.get(chan, [])

                # ---------------------------------------------------------
                # PASSO 1: Encontrar o shift K usando OVERPOSIÇÃO DINÂMICA (Dynamic Barcode)
                # ---------------------------------------------------------
                best_K = len(new_window)
                MIN_OVERLAP = 50  # Assinatura extrema de segurança. Exige que no mínimo 50 linhas batam perfeitamente.

                if old_window and new_window:
                    for K in range(len(new_window)):
                        match_length = len(new_window) - K
                        
                        # Se a quantidade de linhas que sobrou pra testar for menor que a assinatura mínima, 
                        # é estatisticamente perigoso aceitar. Abortamos para forçar o OVERFLOW.
                        if match_length < MIN_OVERLAP:
                            break
                            
                        # Se as fatias são idênticas, encontramos o corte exato.
                        if new_window[K:] == old_window[:match_length]:
                            best_K = K
                            break

                rtd_client.total_reads[chan] += 1
                if best_K > 0:
                    rtd_client.total_refreshes[chan] += 1

                # UPDATE RASTREIO STATS (para o audit log de 5s)
                if hasattr(rtd_client, 'audit_stats') and chan in rtd_client.audit_stats:
                    rtd_client.audit_stats[chan]["reads"] += 1
                    if best_K > 0:
                        rtd_client.audit_stats[chan]["refreshes"] += 1
                        rtd_client.audit_stats[chan]["new_trades"] += best_K
                        if best_K > rtd_client.audit_stats[chan]["max_K"]:
                            rtd_client.audit_stats[chan]["max_K"] = best_K
                        if best_K >= len(new_window) and len(new_window) >= 490:
                            rtd_client.audit_stats[chan]["overflows"] += 1

                # ── OVERFLOW DEFINITIVO POR CICLO ────────────────────────────
                if best_K >= len(new_window) and len(new_window) >= 490:
                    try:
                        import datetime as _dt
                        import time as _t
                        _now = _t.time()
                        _last = getattr(rtd_client, f'_last_read_time_{chan}', _now)
                        delta_ms = (_now - _last) * 1000.0
                        _now_str = _dt.datetime.now().strftime('%H:%M:%S.%f')[:-3]
                        msg = (
                            f"[{_now_str}] 🚨 OVERFLOW REAL ({chan}): best_K={best_K}/{len(new_window)} "
                            f"— janela substituída! (Tempo desde última leitura: {delta_ms:.1f}ms) "
                            f"-> Se o tempo for ~10ms, foi pico de mercado. Se for > 100ms, o Python engasgou.\n"
                        )
                        audit_queue.put(msg)
                    except Exception:
                        pass
                setattr(rtd_client, f'_last_read_time_{chan}', time.time())
                # ─────────────────────────────────────────────────────────────

                # Extraímos estritamente os K trades novos (formato bruto [ts, p, q, side, acp, avd])
                newer_group = new_window[:best_K]

                # A âncora de rastreamento antiga foi removida. O estado passa a ser apenas a janela anterior completa.
                # Salva a janela aceita (para a próxima iteração)
                rtd_client.last_windows[chan] = new_window
                
                # Gravação de diagnóstico removida para performance
                
                # Agrupa os trades pelo ativo normalizado
                if normalized_asset not in grouped_trades:
                    grouped_trades[normalized_asset] = []
                    grouped_info[normalized_asset] = {
                        "price": last_prices_sent.get(normalized_asset, 0.0), 
                        "var": last_variations_sent.get(normalized_asset, 0.0), 
                        "channels": []
                    }
                
                grouped_trades[normalized_asset].extend(newer_group)
                grouped_info[normalized_asset]["channels"].append(chan)
                
                # Se o preço for > 0, atualizamos a info principal do ativo apenas se fizer sentido
                if current_price > 0:
                    is_valid = True
                    if normalized_asset == "WINFUT" and current_price < 50000:
                        is_valid = False
                    if normalized_asset == "WDOFUT" and current_price < 2000:
                        is_valid = False
                    if normalized_asset == "NQM6" and current_price < 12000:
                        is_valid = False
                    if normalized_asset == "ESM6" and current_price > 12000:
                        is_valid = False
                    
                    if is_valid:
                        grouped_info[normalized_asset]["price"] = current_price
                        # Só atualiza a variação se o novo valor for válido (não-zero)
                        # OU se ainda não temos nenhuma variação gravada (0.0 é o padrão inicial)
                        new_var = variation
                        existing_var = grouped_info[normalized_asset]["var"]
                        if new_var != 0.0:
                            grouped_info[normalized_asset]["var"] = new_var
                        elif existing_var == 0.0:
                            grouped_info[normalized_asset]["var"] = new_var

            # --- Transmissão Consolidada por Ativo ---
            for asset, trades_list in grouped_trades.items():
                info = grouped_info[asset]
                current_price = info["price"]
                variation = info["var"]
                channels_str = "+".join(info["channels"])
                
                last_p = last_prices_sent.get(asset, 0)
                last_v = last_variations_sent.get(asset, -999)

                if trades_list or current_price != last_p or variation != last_v:
                    # Ordena cronologicamente os trades combinados de todos os canais deste ativo
                    if trades_list: 
                        trades_list.sort(key=lambda x: x[0])

                    _now_sec = time.time()
                    if not hasattr(rtd_client, '_last_print_time') or _now_sec - rtd_client._last_print_time >= 1.0:
                        rtd_client._last_print_time = _now_sec
                        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [{asset}] Preço: {current_price} | VAR: {variation:+.2f}% | Canais: {channels_str}")
                    
                    tx_queue.put({
                        "type": "NEW_DATA",
                        "channel": channels_str, # Ex: "T&T0+T&T1"
                        "asset": asset,
                        "data": trades_list, 
                        "lastPrice": current_price, 
                        "variation": variation
                    })
                    last_prices_sent[asset] = current_price
                    last_variations_sent[asset] = variation

            # Log de status removido para manter o terminal limpo conforme pedido


            time.sleep(SCAN_INTERVAL)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"[RTD ERROR]: {e}\n{tb}")
            try:
                import os
                log_dir = os.path.join(os.path.dirname(__file__), "..", "logs")
                with open(os.path.join(log_dir, "rtd_audit.log"), "a", encoding="utf-8") as f:
                    f.write(f"\n[CRITICAL ERROR] {tb}\n")
            except: pass

            if rtd_client:
                try:
                    rtd_client.disconnect()
                except Exception as ex:
                    print(f"[RTD ERROR ON DISCONNECT]: {ex}")
            rtd_client = None
            time.sleep(1)


if __name__ == "__main__":
    print("\n" + "="*50)
    print("[ZENITH] MARKET-DATA V7.2.0: MOTOR DE ALTA RESILIENCIA")
    print("="*50)
    
    # Inicia a conexão WS apenas UMA vez no boot do processo
    start_ws()
    
    while True:
        try:
            # Inicia o motor de leitura
            main()
            
        except KeyboardInterrupt:
            print("\n[SISTEMA]: Encerrando pelo usuário...")
            break
        except Exception as e:
            print(f"\n[ERRO CRÍTICO NO MOTOR]: {e}")
            print("[SISTEMA]: Reiniciando motor completo em 5 segundos...")
            time.sleep(5)

