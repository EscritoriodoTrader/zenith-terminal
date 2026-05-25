# -*- coding: utf-8 -*-
"""
Historico.py — Zenith History Parser & Loader
Responsável por:
1. Buscar os arquivos de histórico 'Historico-Nasdaq' e 'Historico-s&p' na pasta raiz do Zenith.
2. Analisar as linhas de Times & Trades (tab-separated) exportadas da BlackArrow.
3. Executar o processo de desduplicação/sequenciamento ('_seqN') para garantir UIDs únicos.
4. Inserir os lotes em altíssima velocidade via HTTP POST direto na API do servidor Zenith.
"""

import os
import sys
import io
import time
import json
import datetime
import requests
import concurrent.futures

# Força codificação UTF-8 na console do Windows para evitar crash com emojis
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

LOCAL_SERVER = "127.0.0.1:3000"
POST_URL = f"http://{LOCAL_SERVER}/api/trades"

def clean_price(val, asset_name):
    try:
        if isinstance(val, (float, int)): 
            n = float(val)
        else:
            s = str(val).strip().replace(' ', '')
            if ',' in s and '.' in s: s = s.replace('.', '').replace(',', '.')
            elif ',' in s: s = s.replace(',', '.')
            n = float(s)
        
        # Ajuste de escala se vier sem ponto decimal do RTD/DDE (ex: > 100000)
        # Aplicamos APENAS para ativos americanos (NQ, ES) para não corromper os índices da B3 (WIN, IND)
        if asset_name:
            an = asset_name.upper()
            if ("NQ" in an or "ES" in an) and n > 100000:
                n = n / 100.0
        elif n > 200000:
            n = n / 100.0
        return n
    except:
        return 0.0

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

def process_time(val, now):
    try:
        if not val: return None
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
            if dt > now + datetime.timedelta(hours=2): 
                dt -= datetime.timedelta(days=1)
            
        return int(dt.timestamp() * 1000)
    except Exception:
        return None

def normalize_side(val):
    if not val: return "BUY"
    s = str(val).upper().strip()
    if s.startswith('V') or s.startswith('S'): return "SELL"
    if s.startswith('C') or s.startswith('B'): return "BUY"
    return "BUY"

def parse_history_file(file_path, asset_name):
    print(f"\n[HISTÓRICO]: 📂 Analisando arquivo {os.path.basename(file_path)} para o ativo {asset_name}...")
    
    if not os.path.exists(file_path):
        print(f"[HISTÓRICO]: ⚠️ Arquivo não encontrado: {file_path}")
        return []

    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"[HISTÓRICO]: ❌ Erro ao abrir arquivo: {e}")
        return []

    # Mapeamento Dinâmico de Colunas por Cabeçalho
    time_idx = 0
    price_idx = 2
    qty_idx = 3
    agressor_idx = 5

    # Encontra o cabeçalho se houver
    header_idx = -1
    for i, line in enumerate(lines[:15]):
        line_clean = line.strip().lower()
        if not line_clean: continue
        
        # Se contiver palavras chaves comuns de Times & Trades
        if 'preço' in line_clean or 'price' in line_clean or 'agressor' in line_clean or 'quantidade' in line_clean:
            header_idx = i
            parts = line.strip().split('\t')
            for col_idx, part in enumerate(parts):
                part_clean = part.strip().lower()
                if 'horário' in part_clean or 'hora' in part_clean or 'time' in part_clean or 'data' in part_clean:
                    time_idx = col_idx
                elif 'preço' in part_clean or 'price' in part_clean or 'valor' in part_clean or 'value' in part_clean:
                    if 'total' not in part_clean:
                        price_idx = col_idx
                elif 'quantidade' in part_clean or 'qtd' in part_clean or 'qty' in part_clean:
                    qty_idx = col_idx
                elif 'agressor' in part_clean or 'agressão' in part_clean or 'side' in part_clean:
                    if 'agente' not in part_clean:
                        agressor_idx = col_idx
            break

    print(f"[HISTÓRICO]: 📊 Cabeçalho detectado na linha {header_idx}. Índices mapeados: Hora={time_idx}, Preço={price_idx}, Qtd={qty_idx}, Agressor={agressor_idx}")

    # Identifica o início dos dados numéricos
    start_idx = 0
    for i, line in enumerate(lines[:15]):
        if line.strip() and line[0].isdigit() and i > header_idx:
            start_idx = i
            break
            
    raw_data = []
    max_idx = max(time_idx, price_idx, qty_idx, agressor_idx)
    
    for line in lines[start_idx:]:
        if not line.strip(): continue
        parts = line.strip().split('\t')
        
        # Fallback robusto se a linha for menor que o esperado mas tiver colunas suficientes
        if len(parts) > max_idx:
            raw_data.append(parts)
        elif len(parts) >= 4:
            # Fallback padrão de 4 colunas: Hora, Preço, Qtd, Agressor
            raw_data.append([parts[0], "", parts[1], parts[2], "", parts[3]])
            
    if not raw_data:
        print(f"[HISTÓRICO]: ⚠️ Nenhuma linha de trade válida encontrada em {os.path.basename(file_path)}.")
        return []

    now = datetime.datetime.now()
    parsed_list = []
    
    print(f"[HISTÓRICO]: ⚙️ Processando {len(raw_data)} linhas com prevenção de duplicados...")
    
    for row_idx, row in enumerate(raw_data):
        # Validação segura dos índices mapeados
        try:
            raw_t = row[time_idx]
            raw_p = row[price_idx]
            raw_q = row[qty_idx]
            raw_a = row[agressor_idx]
        except IndexError:
            # Fallback para o caso de índice fora do range
            continue
            
        if not raw_t or not raw_p or not raw_q: continue
            
        ts = process_time(raw_t, now)
        if not ts: continue
            
        price = clean_price(raw_p, asset_name)
        if price <= 0: continue
        
        # Filtro de Segurança de Faixa de Preço para Nasdaq/S&P
        is_nq = "NQ" in asset_name.upper()
        is_es = "ES" in asset_name.upper()
        if is_nq and price < 12000:
            continue
        if is_es and price > 12000:
            continue

        quantity = clean_quantity(raw_q)
            
        side = normalize_side(raw_a)
        
        parsed_list.append({
            "timestamp": ts,
            "price": price,
            "quantity": quantity,
            "side": side,
            "asset": asset_name
        })
        
    # Garante ordenação estritamente cronológica (do mais antigo para o mais novo) antes de gerar os IDs sequenciais
    parsed_list.sort(key=lambda x: x['timestamp'])
    
    trades = []
    ts_counters = {}
    for t in parsed_list:
        ts = t["timestamp"]
        price = t["price"]
        quantity = t["quantity"]
        side = t["side"]
        
        base_id = f"{asset_name}_{side}_{ts}_{price}_{quantity}"
        ts_counters[base_id] = ts_counters.get(base_id, 0) + 1
        uid = f"{base_id}_seq{ts_counters[base_id]}"
        
        t["id"] = uid
        trades.append(t)
        
    print(f"[HISTÓRICO]: ✅ {len(trades)} trades extraídos com sucesso para {asset_name}!")
    return trades

def send_trades_in_batches(trades, asset_name):
    if not trades: return
    
    total = len(trades)
    print(f"[HISTÓRICO]: 🚀 Transmitindo {total} trades para o servidor Zenith...")
    
    session = requests.Session()
    
    def send_batch(batch):
        try:
            res = session.post(POST_URL, json={"asset": asset_name, "data": batch, "isHistory": True}, timeout=20)
            return res.status_code == 200
        except Exception:
            return False

    batches = [trades[i:i + 5000] for i in range(0, total, 5000)]
    success_count = 0
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(send_batch, batches))
        for success in results:
            if success:
                success_count += 5000
                
    success_count = min(success_count, total)
    print(f"[HISTÓRICO]: 🎉 Transmissão concluída! {success_count}/{total} trades integrados com sucesso para {asset_name}!")

def main():
    print("=" * 60)
    print("🌅   ZENITH HISTORY ENGINE V2.0 — MONTADOR DE HISTÓRICO   🌅")
    print("=" * 60)
    
    base_dir = os.path.dirname(os.path.abspath(__file__)) # dados/python/
    root_dir = os.path.dirname(os.path.dirname(base_dir)) # c:/FOOTPRINT
    
    # 1. Escaneia dinamicamente a pasta raiz por arquivos de histórico
    found_files = []
    
    # Adiciona opções de fallback estáticas se existirem
    static_fallbacks = [
        {"file": "Historico.txt", "asset": "NQM6"},
        {"file": "Historico.csv", "asset": "NQM6"},
        {"file": "candle.pontos", "asset": "NQM6"}
    ]
    for sf in static_fallbacks:
        sf_path = os.path.join(root_dir, sf["file"])
        if os.path.exists(sf_path) and os.path.getsize(sf_path) > 0:
            found_files.append({"file": sf["file"], "asset": sf["asset"], "path": sf_path})

    # Varre a pasta por arquivos com padrão 'Historico-*'
    try:
        for f_name in os.listdir(root_dir):
            if f_name.startswith("Historico-"):
                f_path = os.path.join(root_dir, f_name)
                if os.path.isfile(f_path) and os.path.getsize(f_path) > 0:
                    suffix_upper = f_name.replace("Historico-", "").strip().upper()
                    if suffix_upper == "NASDAQ":
                        asset = "NQM6"
                    elif suffix_upper in ["S&P", "S&P500", "SP"]:
                        asset = "ESM6"
                    elif suffix_upper.startswith("WIN") or suffix_upper.startswith("IND"):
                        asset = "WINFUT"
                    elif suffix_upper.startswith("WDO") or suffix_upper.startswith("DOL"):
                        asset = "WDOFUT"
                    else:
                        asset = suffix_upper
                    
                    # Evita duplicados na lista
                    if not any(x["file"] == f_name for x in found_files):
                        found_files.append({"file": f_name, "asset": asset, "path": f_path})
    except Exception as e:
        print(f"[HISTÓRICO]: ⚠️ Erro ao varrer pasta por arquivos de histórico: {e}")

    files_processed = 0
    total_inserted = 0
    
    for item in found_files:
        path = item["path"]
        trades = parse_history_file(path, item["asset"])
        if trades:
            # 1. Encontra o maior timestamp do histórico carregado
            max_ts = max(t['timestamp'] for t in trades)
            
            # 2. Solicita ao servidor para limpar sobreposições no banco e atualizar a barreira temporal do tempo real
            try:
                prep_url = f"http://{LOCAL_SERVER}/api/trades/prepare-history"
                res = requests.post(prep_url, json={"asset": item["asset"], "maxTimestamp": max_ts}, timeout=10)
                if res.status_code == 200:
                    deleted = res.json().get('deletedCount', 0)
                    print(f"[HISTÓRICO]: 🧹 Limpeza de sobreposição concluída no servidor ({deleted} trades em tempo real removidos).")
            except Exception as e:
                print(f"[HISTÓRICO]: ⚠️ Aviso: Não foi possível realizar a limpeza de sobreposição no servidor: {e}")
            
            # 3. Envia o histórico limpo e sequenciado
            send_trades_in_batches(trades, item["asset"])
            total_inserted += len(trades)
            files_processed += 1
                
    if files_processed == 0:
        print("\n[HISTÓRICO]: ⚠️ Nenhum arquivo de histórico encontrado na pasta raiz!")
        print("  → Por favor, coloque os arquivos exportados da BlackArrow na pasta 'c:\\FOOTPRINT'")
        print("  → Nomes válidos: 'Historico-Nasdaq', 'Historico-s&p', 'Historico-WIN' etc.")
    else:
        print(f"\n[HISTÓRICO]: 🌟 Sincronização concluída com sucesso! Total de {total_inserted} trades carregados de {files_processed} arquivos.")
    print("=" * 60)

if __name__ == "__main__":
    main()
