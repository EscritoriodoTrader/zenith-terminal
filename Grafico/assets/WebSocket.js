/**
 * WebSocket.js — Ponte de Dados (equivalente ao WebSocket.worker da BlackArrow)
 * Responsabilidade: conectar ao server.js, receber trades ao vivo e
 * alimentar o CandleBuilder via EventBus.
 *
 * Depende de: web.dv.js (window.Z.EventBus, Store, Logger, Fmt)
 *             web.cs.js (window.Z.CandleBuilder)
 */

'use strict';

const DataBridge = (() => {
    const { EventBus, Store, Logger, Fmt } = window.Z;

    const WS_URL = 'ws://127.0.0.1:3000';
    const RECONNECT_MS = 3000;

    let _ws = null;
    let _reconnectTimer = null;
    let _intentional = false;   // evita reconectar quando o usuário fecha
    let _historyActive = false;   // true enquanto carrega histórico
    const _historyCache = new Map(); // Cache RAM de histórico para abas

    /* ── Estatísticas de sessão ── */
    const _stats = {
        tradesReceived: 0,
        messagesIn: 0,
        connectedAt: null,
    };

    /* ----------------------------------------------------------
       CONEXÃO
    ---------------------------------------------------------- */
    function connect() {
        if (_ws && (_ws.readyState === WebSocket.OPEN ||
            _ws.readyState === WebSocket.CONNECTING)) return;

        Logger.info(`🔌 Conectando ao servidor: ${WS_URL}`);
        _ws = new WebSocket(WS_URL);

        /* ── OPEN ── */
        _ws.addEventListener('open', () => {
            Logger.info('✅ Conexão com servidor estabelecida.');
            _stats.connectedAt = Date.now();
            Store.set('connected', true);
            EventBus.emit('ws:connected');

            // Avisa o servidor quem somos
            _send({ type: 'CLIENT_HELLO', client: 'ZENITH_GRAFICO' });
        });

        /* ── MESSAGE ── */
        _ws.addEventListener('message', (e) => {
            _stats.messagesIn++;
            try {
                const msg = JSON.parse(e.data);
                _route(msg);
            } catch {
                // mensagem não-JSON — ignora silenciosamente
            }
        });

        /* ── CLOSE ── */
        _ws.addEventListener('close', () => {
            Store.set('connected', false);
            Store.set('pythonOnline', false);
            EventBus.emit('ws:disconnected');
            Logger.warn('🔌 Conexão encerrada.');
            if (!_intentional) _scheduleReconnect();
        });

        /* ── ERROR ── */
        _ws.addEventListener('error', () => {
            // O evento 'close' vai disparar na sequência — não precisa tratar aqui
        });
    }

    function _scheduleReconnect() {
        clearTimeout(_reconnectTimer);
        _reconnectTimer = setTimeout(() => {
            Logger.info(`🔄 Tentando reconectar...`);
            connect();
        }, RECONNECT_MS);
    }

    function disconnect() {
        _intentional = true;
        clearTimeout(_reconnectTimer);
        _ws?.close();
    }

    /* ----------------------------------------------------------
       ENVIO
    ---------------------------------------------------------- */
    function _send(obj) {
        if (_ws?.readyState === WebSocket.OPEN) {
            _ws.send(JSON.stringify(obj));
        }
    }

    /* ----------------------------------------------------------
       ROTEADOR DE MENSAGENS
       Mesmo padrão de switch/case do WebSocket.worker BlackArrow
    ---------------------------------------------------------- */
    function _route(msg) {
        switch (msg.type) {

            /* ── Dados ao vivo do Python ── */
            case 'NEW_DATA':
                _handleNewData(msg);
                break;

            /* ── Início do carregamento de histórico ── */
            case 'START_HISTORY':
                _historyActive = true;
                Logger.info(`📜 Carregando histórico (${msg.count ?? '?'} trades)...`);
                EventBus.emit('ws:historyStart', msg.count);
                break;

            /* ── Fim do histórico ── */
            case 'END_HISTORY':
                _historyActive = false;
                Logger.info('✅ Histórico carregado.');
                EventBus.emit('ws:historyEnd', msg.lastFileTs);
                break;

            /* ── Status do processo Python Historico.py ── */
            case 'PYTHON_HISTORY_START':
                EventBus.emit('python:historyStart');
                break;

            case 'PYTHON_HISTORY_END':
                EventBus.emit('python:historyEnd', msg.success);
                break;

            /* ── Python online ── */
            case 'PYTHON_CONNECT':
                Store.set('pythonOnline', true);
                EventBus.emit('ws:pythonOnline');
                Logger.info('🐍 Motor Python conectado.');
                break;

            /* ── Status do motor (ligado/desligado) ── */
            case 'MOTOR_STATUS':
            case 'TOGGLE_MOTOR':
                Store.set('motorRunning', msg.running ?? true);
                EventBus.emit('ws:motorStatus', msg.running);
                break;

            /* ── Lista de ativos (para a Lupa) ── */
            case 'ASSET_LIST_RESPONSE':
                Store.set('assetList', msg.assets || []);
                EventBus.emit('ws:assetList', msg.assets);
                break;

            /* ── Handshakes e PING — ignorar silenciosamente ── */
            case 'CONNECTED':
            case 'HANDSHAKE':
            case 'AUTH_OK':
            case 'SESSION':
            case 'PING':
                break;

            default:
                // Mensagem desconhecida — log de debug
                Logger.debug('MSG desconhecida:', msg.type);
        }
    }

    /* ----------------------------------------------------------
       HANDLER PRINCIPAL — NEW_DATA
       Formato recebido do server.js / Python:
       {
         type:       "NEW_DATA",
         channel:    "T&T0",
         asset:      "MNQFUT",
         data:       [{ id, timestamp, price, quantity, side }],
         lastPrice:  21237.5,
    ---------------------------------------------------------- */
    function _handleNewData(data) {
        const { channel, asset, lastPrice, variation, data: trades } = data;

        // Limpa formatações e unifica os nomes (NQM6_M_15 -> NQM6)
        const normAsset = String(asset).toUpperCase().replace(/_M_\d+$/, '').trim();

        // Salva TODOS os trades no Cache de Histórico instantâneo, não importa se é o ativo ativo ou não
        if (trades && trades.length > 0 && asset !== 'HISTORICO') {
            if (!_historyCache.has(normAsset)) {
                _historyCache.set(normAsset, []);
            }
            const cache = _historyCache.get(normAsset);
            // Evita estouro de memória limitando a 1.000.000 trades por ativo
            if (cache.length > 1000000) {
                cache.splice(0, cache.length - 800000);
            }
            cache.push(...trades);
        }

        // Filtra apenas o ativo selecionado (ou aceita tudo se não há seleção)
        const activeAsset = Store.get('activeAsset');
        let isSelected = false;
        let normActive = '';
        if (!activeAsset || asset === 'HISTORICO') {
            isSelected = true;
        } else {
            normActive = String(activeAsset.ticker || activeAsset).toUpperCase().replace(/_M_\d+$/, '').trim();
            isSelected = (normAsset === normActive) ||
                (normActive.slice(0, 2) === normAsset.slice(0, 2)) ||
                (normActive.includes('NQ') && normAsset.includes('NQ')) ||
                (normActive.includes('ES') && normAsset.includes('ES'));
        }

        // Validação Cruzada de Segurança por Faixa de Preço no Frontend
        if (isSelected && activeAsset && asset !== 'HISTORICO') {
            const activeTicker = String(activeAsset.ticker || activeAsset).toUpperCase();
            
            // 1. Validar usando lastPrice
            if (lastPrice > 0) {
                if (activeTicker.includes('NQ') && lastPrice < 12000) isSelected = false;
                if (activeTicker.includes('ES') && lastPrice > 12000) isSelected = false;
            }
            
            // 2. Validar usando os trades recebidos
            if (isSelected && trades && trades.length > 0) {
                const firstPrice = typeof trades[0].price === 'number' ? trades[0].price : parseFloat(trades[0].price);
                if (firstPrice > 0) {
                    if (activeTicker.includes('NQ') && firstPrice < 12000) isSelected = false;
                    if (activeTicker.includes('ES') && firstPrice > 12000) isSelected = false;
                }
            }
        }

        // Armazena ativo ativo detectado apenas se for o ativo selecionado
        if (isSelected && asset !== 'HISTORICO') {
            Store.set('lastPrice', lastPrice);
            Store.set('variation', variation);
        }

        if (isSelected && trades && trades.length > 0) {
            // Injeta no CandleBuilder (que está em web.cs.js)
            window.Z.CandleBuilder.addTrades(trades);
            Store.set('candleCount', window.Z.CandleBuilder.count);
        }

        // Emite evento para qualquer listener externo (ex: statusbar)
        EventBus.emit('ws:newData', {
            asset,
            trades,
            lastPrice,
            variation,
            isHistory: _historyActive
        });
    }

    /* ----------------------------------------------------------
       COMANDOS PÚBLICOS
    ---------------------------------------------------------- */
    return {
        connect,
        disconnect,

        /** Troca o ativo monitorado */
        changeAsset(channel, asset) {
            _send({ type: 'CHANGE_ASSET', channel, asset });
            Logger.info(`🔀 Trocando ativo: ${channel} → ${asset}`);
        },

        /** Carrega histórico de trades do Supabase para o ativo especificado */
        async loadHistoryFromDb(asset) {
            if (!asset) return;
            const normAsset = String(asset).toUpperCase().replace(/_M_\d+$/, '').trim();

            // 1. TENTA CARREGAR DO CACHE RAM PRIMEIRO PARA TRANSIÇÃO INSTANTÂNEA
            if (_historyCache.has(normAsset) && _historyCache.get(normAsset).length > 0) {
                Logger.info(`⚡ Histórico carregado do Cache RAM para ${asset}: ${_historyCache.get(normAsset).length} trades.`);
                window.Z.CandleBuilder.reset();
                window.Z.CandleBuilder.addTrades(_historyCache.get(normAsset));
                Store.set('candleCount', window.Z.CandleBuilder.count);
                EventBus.emit('candle:update');
                
                // Busca o restante no background sem limpar a tela
                this._fetchDbBackground(asset, normAsset);
                return;
            }

            // 2. SE NÃO TEM CACHE, FAZ O FETCH SÍNCRONO (Bloqueante)
            try {
                Logger.info(`📥 Buscando histórico do Supabase para o ativo: ${asset}...`);
                const host = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
                const response = await fetch(`${host}/api/trades/${asset}`);
                if (!response.ok) throw new Error(`Status HTTP: ${response.status}`);
                const trades = await response.json();
                Logger.info(`✅ Histórico carregado do Supabase para ${asset}: ${trades.length} trades.`);

                _historyCache.set(normAsset, trades); // Preenche o cache

                // Confirma que o ativo não foi trocado enquanto baixava
                const activeAsset = Store.get('activeAsset');
                const normActive = activeAsset ? String(activeAsset.ticker || activeAsset).toUpperCase().replace(/_M_\d+$/, '').trim() : '';
                
                const isMatch = (normActive === normAsset) ||
                    (normActive.slice(0, 2) === normAsset.slice(0, 2) && normActive.slice(0, 2) === "WI") ||
                    (normActive.slice(0, 2) === normAsset.slice(0, 2) && normActive.slice(0, 2) === "WD") ||
                    (normActive.includes('NQ') && normAsset.includes('NQ')) ||
                    (normActive.includes('ES') && normAsset.includes('ES'));
                
                if (isMatch) {
                    window.Z.CandleBuilder.reset();
                    if (trades && trades.length > 0) {
                        window.Z.CandleBuilder.addTrades(trades);
                    }
                    Store.set('candleCount', window.Z.CandleBuilder.count);
                    EventBus.emit('candle:update');
                }
            } catch (err) {
                Logger.error(`❌ Falha ao carregar histórico do Supabase para ${asset}:`, err.message);
            }
        },

        async _fetchDbBackground(asset, normAsset) {
            try {
                const host = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
                const response = await fetch(`${host}/api/trades/${asset}`);
                if (!response.ok) return;
                const dbTrades = await response.json();
                
                if (dbTrades && dbTrades.length > 0) {
                    // Mescla o cache existente com os do banco, garantindo ordem e sem duplicatas
                    const currentCache = _historyCache.get(normAsset) || [];
                    const allTrades = [...dbTrades, ...currentCache];
                    
                    // Remove duplicatas usando o ID único (ou fallback seguro de timestamp, preço, quantidade e lado)
                    const uniqueMap = new Map();
                    allTrades.forEach(t => {
                        const key = t.id || `${t.timestamp}_${t.price}_${t.quantity}_${t.side}`;
                        uniqueMap.set(key, t);
                    });
                    
                    const merged = Array.from(uniqueMap.values());
                    merged.sort((a, b) => a.timestamp - b.timestamp);
                    
                    // Limita a 1.000.000
                    if (merged.length > 1000000) merged.splice(0, merged.length - 800000);
                    _historyCache.set(normAsset, merged);
                    
                    // Se continua sendo o ativo ativo, atualiza silenciosamente (reset + add)
                    const activeAsset = Store.get('activeAsset');
                    const normActive = activeAsset ? String(activeAsset.ticker || activeAsset).toUpperCase().replace(/_M_\d+$/, '').trim() : '';
                    
                    const isMatch = (normActive === normAsset) ||
                        (normActive.slice(0, 2) === normAsset.slice(0, 2) && normActive.slice(0, 2) === "WI") ||
                        (normActive.slice(0, 2) === normAsset.slice(0, 2) && normActive.slice(0, 2) === "WD") ||
                        (normActive.includes('NQ') && normAsset.includes('NQ')) ||
                        (normActive.includes('ES') && normAsset.includes('ES'));
                        
                    if (isMatch) {
                        const currentOpenCandle = window.Z.CandleBuilder.getCurrent();
                        window.Z.CandleBuilder.reset();
                        window.Z.CandleBuilder.addTrades(merged);
                        Store.set('candleCount', window.Z.CandleBuilder.count);
                        EventBus.emit('candle:update');
                    }
                }
            } catch (err) {
                // Background fail ignora silenciosamente
            }
        },

        /** Pede ao servidor para limpar o gráfico e banco */
        clearChart() {
            window.Z.CandleBuilder.reset();
            _send({ type: 'CLEAR_CHART' });
            Logger.info('🧹 Gráfico limpo.');
        },

        /** Solicita recarregamento do histórico */
        reloadHistory() {
            window.Z.CandleBuilder.reset();
            _send({ type: 'RELOAD_HISTORY' });
            Logger.info('📜 Solicitando recarga de histórico...');
        },

        /** Solicita que o Python leia e grave o histórico no banco */
        runPythonHistory() {
            _send({ type: 'RUN_PYTHON_HISTORY' });
            Logger.info('🐍 Solicitando ao Python a importação do histórico para o banco...');
        },

        /** Liga/desliga o motor Python */
        toggleMotor(running) {
            _send({ type: 'TOGGLE_MOTOR', running });
        },

        /** Solicita a lista de ativos detectados pelo servidor */
        requestAssetList() {
            _send({ type: 'REQUEST_SECURITY_LIST' });
        },

        /** Retorna estatísticas da sessão */
        getStats() {
            return {
                ..._stats,
                uptime: _stats.connectedAt
                    ? Math.floor((Date.now() - _stats.connectedAt) / 1000)
                    : 0
            };
        },

        get connected() {
            return _ws?.readyState === WebSocket.OPEN;
        }
    };
})();

/* ============================================================
   AUTO-INICIALIZAÇÃO — assim que o DOM estiver pronto
   (defer no HTML garante isso)
   ============================================================ */
DataBridge.connect();

/* ── Exporta no namespace global ── */
window.Z.DataBridge = DataBridge;

Logger.info('✅ WebSocket Bridge carregado (WebSocket.js)');
