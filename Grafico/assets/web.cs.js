/**
 * web.cs.js — Shared Utilities (equivalente ao web-CSIOoZqo.js da BlackArrow)
 * Responsabilidade: lógica de negócio compartilhada entre módulos
 * Depende de: web.dv.js (window.Z)
 */

'use strict';

(() => {
const { EventBus, Store, Logger } = window.Z;

/* ============================================================
   1. CANDLE BUILDER — agrega trades em candles OHLC
   (equivalente ao processamento interno do WebSocket.worker)
   ============================================================ */
const CandleBuilder = (() => {

    // Tabela de períodos em ms
    const PERIOD_MS = {
        '1':   60_000,
        '2':   120_000,
        '3':   180_000,
        '5':   300_000,
        '10':  600_000,
        '15':  900_000,
        '30':  1_800_000,
        '60':  3_600_000,
        '120': 7_200_000,
        '240': 14_400_000,
        'D':   86_400_000,
        '1D':  86_400_000,
    };

    let _activePeriod = '1';
    let _periodMs   = PERIOD_MS['1'];
    let _candles    = [];           // Array de candles completos
    let _openCandle = null;         // Candle sendo formado
    let _processedTradeIds = new Set(); // Prevenção de duplicados na visualização

    /**
     * Estrutura de um candle:
     * {
     *   ts:       number,  // timestamp de abertura (início do período)
     *   open:     number,
     *   high:     number,
     *   low:      number,
     *   close:    number,
     *   volume:   number,  // quantidade total
     *   buyVol:   number,  // volume comprador
     *   sellVol:  number,  // volume vendedor
     *   delta:    number,  // buyVol - sellVol
     *   trades:   number,  // número de trades
     *   levels:   Map<price, { buy, sell }>  // para footprint
     * }
     */

    function _newCandle(ts, trade) {
        return {
            ts:      ts,
            open:    trade.price,
            high:    trade.price,
            low:     trade.price,
            close:   trade.price,
            volume:  0,
            buyVol:  0,
            sellVol: 0,
            delta:   0,
            trades:  0,
            levels:  new Map()
        };
    }

    function _applyTrade(candle, trade) {
        const { price, quantity, side } = trade;

        if (price > candle.high)  candle.high  = price;
        if (price < candle.low)   candle.low   = price;
        candle.close  = price;
        candle.volume += quantity;
        candle.trades++;

        // UNKNOWN = trade sem agressor (Direto, Leilão, etc)
        // Conta no volume total mas não distorce compra/venda/delta
        if (side === 'BUY') {
            candle.buyVol  += quantity;
        } else if (side === 'SELL') {
            candle.sellVol += quantity;
        }
        // side === 'UNKNOWN': não soma em buyVol nem sellVol
        candle.delta = candle.buyVol - candle.sellVol;

        // Footprint: acumula por nível de preço
        if (!candle.levels.has(price)) {
            candle.levels.set(price, { buy: 0, sell: 0 });
        }
        const lvl = candle.levels.get(price);
        if (side === 'BUY')       lvl.buy  += quantity;
        else if (side === 'SELL') lvl.sell += quantity;
        // UNKNOWN: não distorce o footprint direcional
    }

    return {
        /**
         * Define o período ativo
         * @param {string} period  ex: '1', '5', '15', 'D', '5P'
         */
        setPeriod(period) {
            _activePeriod = period;
            _periodMs = PERIOD_MS[period] || PERIOD_MS['1'];
            Logger.info(`Período definido: ${period}`);
        },

        /**
         * Reseta todos os candles (troca de ativo ou clear)
         */
        reset() {
            _candles    = [];
            _openCandle = null;
            _processedTradeIds.clear();
            EventBus.emit('candle:reset');
        },

        /**
         * Processa um array de trades e atualiza os candles
         * @param {Array<{timestamp, price, quantity, side}>} trades
         */
        addTrades(trades) {
            if (!trades || trades.length === 0) return;

            const pointsMatch = _activePeriod.match(/^(\d+)P$/i);
            const isPointsMode = !!pointsMatch;
            const pointsValue = isPointsMode ? parseInt(pointsMatch[1], 10) : 5;
            const tick = PriceScale.tickSize || 0.25;
            const rangeLimit = pointsValue * tick; 

            for (const trade of trades) {
                // Prevenção de Duplicados
                if (trade.id) {
                    if (_processedTradeIds.has(trade.id)) {
                        continue;
                    }
                    _processedTradeIds.add(trade.id);
                }

                trade.price = typeof trade.price === 'number' ? trade.price : parseFloat(trade.price);
                trade.quantity = typeof trade.quantity === 'number' ? trade.quantity : parseInt(trade.quantity, 10);
                
                const timestamp = typeof trade.timestamp === 'number' ? trade.timestamp : parseInt(trade.timestamp, 10);

                // Descarta trades com timestamp inválido (0, NaN, ou antes de 2020)
                // Evita o "candle fantasma" de 31/dez/1969 (epoch zero)
                if (!timestamp || isNaN(timestamp) || timestamp < 1577836800000) continue;

                if (isPointsMode) {
                    // --- LÓGICA DE GRÁFICO DE PONTOS (P) - PARIDADE BLACKARROW/NELOGICA ---
                    if (!_openCandle) {
                        _openCandle = _newCandle(timestamp, trade);
                    }

                    let currentPrice = trade.price;

                    while (true) {
                        const diff = currentPrice - _openCandle.open;

                        if (diff >= rangeLimit) {
                            const targetClose = _openCandle.open + rangeLimit;

                            // Aplica o trade atual (limitado ao targetClose) no candle que está fechando
                            _applyTrade(_openCandle, { ...trade, price: targetClose });
                            if (currentPrice > _openCandle.high) {
                                _openCandle.high = currentPrice;
                            }

                            _candles.push(_openCandle);
                            EventBus.emit('candle:closed', _openCandle);

                            // Abre o novo candle no preço de fechamento exato do anterior
                            _openCandle = _newCandle(timestamp, { price: targetClose });

                            // Se o preço real do trade superou o limite (gap), o novo candle registra isso
                            if (currentPrice > targetClose) {
                                _openCandle.high = Math.max(_openCandle.high, currentPrice);
                                _openCandle.close = currentPrice;
                            }
                        } else if (diff <= -rangeLimit) {
                            const targetClose = _openCandle.open - rangeLimit;

                            // Aplica o trade atual (limitado ao targetClose) no candle que está fechando
                            _applyTrade(_openCandle, { ...trade, price: targetClose });
                            if (currentPrice < _openCandle.low) {
                                _openCandle.low = currentPrice;
                            }

                            _candles.push(_openCandle);
                            EventBus.emit('candle:closed', _openCandle);

                            // Abre o novo candle no preço de fechamento exato do anterior
                            _openCandle = _newCandle(timestamp, { price: targetClose });

                            // Se o preço real do trade superou o limite (gap), o novo candle registra isso
                            if (currentPrice < targetClose) {
                                _openCandle.low = Math.min(_openCandle.low, currentPrice);
                                _openCandle.close = currentPrice;
                            }
                        } else {
                            // Dentro do limite, aplica o trade completo e encerra
                            _applyTrade(_openCandle, trade);
                            break;
                        }
                    }
                } else {
                    // --- LÓGICA TEMPORAL TRADICIONAL (Minutos) ---
                    const candleTs = Math.floor(timestamp / _periodMs) * _periodMs;

                    if (_openCandle && _openCandle.ts !== candleTs) {
                        if (candleTs < _openCandle.ts) {
                            // Trade atrasado, procura nos candles fechados para injetar
                            let found = false;
                            for (let i = _candles.length - 1; i >= 0; i--) {
                                if (_candles[i].ts === candleTs) {
                                    _applyTrade(_candles[i], trade);
                                    EventBus.emit('candle:update', _candles[i]);
                                    found = true;
                                    break;
                                }
                            }
                            if (found) continue; // Pula para o próximo trade, já processou
                        } else {
                            // Trade do futuro (novo candle), fecha o atual
                            _candles.push(_openCandle);
                            EventBus.emit('candle:closed', _openCandle);
                            _openCandle = null;
                        }
                    }

                    if (!_openCandle) {
                        _openCandle = _newCandle(candleTs, trade);
                    }

                    if (_openCandle && _openCandle.ts === candleTs) {
                        _applyTrade(_openCandle, trade);
                    }
                }
            }

            // Emite o candle aberto (atualização ao vivo)
            if (_openCandle) {
                EventBus.emit('candle:update', _openCandle);
            }

            // Limita o Set de IDs para evitar acumulo de memória e colisões após sessões longas
            if (_processedTradeIds.size > 50000) {
                // Mantém apenas os 25.000 mais recentes (Set preserva ordem de inserção)
                const arr = Array.from(_processedTradeIds);
                _processedTradeIds = new Set(arr.slice(arr.length - 25000));
            }
        },

        /** Retorna todos os candles fechados + o aberto no final */
        getAll() {
            return _openCandle ? [..._candles, _openCandle] : [..._candles];
        },

        /** Retorna apenas o candle em formação */
        getCurrent() { return _openCandle; },

        /** Total de candles */
        get count() { return _candles.length + (_openCandle ? 1 : 0); }
    };
})();

/* ============================================================
   2. PRICE SCALE — gerencia escala de preço e eixo Y do gráfico
   ============================================================ */
const PriceScale = (() => {
    let _min = 0, _max = 0, _height = 0, _tickSize = 0.25;

    return {
        /** Atualiza os limites de preço visíveis */
        setRange(min, max, height) {
            _min    = min;
            _max    = max;
            _height = height;
        },

        setTickSize(ts) { _tickSize = ts; },

        /**
         * Converte preço para posição Y em pixels
         * @param {number} price
         */
        toY(price) {
            if (_max === _min) return _height / 2;
            return _height - ((price - _min) / (_max - _min)) * _height;
        },

        /**
         * Converte posição Y para preço
         * @param {number} y
         */
        toPrice(y) {
            return _min + ((_height - y) / _height) * (_max - _min);
        },

        /** Arredonda preço para o tick size do ativo */
        snap(price) {
            return Math.round(price / _tickSize) * _tickSize;
        },

        get min() { return _min; },
        get max() { return _max; },
        get range() { return _max - _min; },
        get tickSize() { return _tickSize; }
    };
})();

/* ============================================================
   3. TIME SCALE — gerencia eixo X (tempo) do gráfico
   ============================================================ */
const TimeScale = (() => {
    let _candles    = [];
    let _viewStart  = 0;   // índice do primeiro candle visível
    let _viewEnd    = 0;   // índice do último candle visível
    let _candleW    = 120; // largura em pixels de cada candle (modo footprint por padrão)
    let _gap        = 4;   // gap entre candles
    let _width      = 0;   // largura total da área de gráfico
    let _scrollOffset = 0; // deslocamento de candles a partir da direita (0 = ao vivo)

    return {
        setData(candles, width) {
            _candles = candles;
            _width   = width;
            
            // Eixo de preço: 70px (AXIS_PRICE_W = 70 em chart.js)
            const AXIS_W = 70;
            // Quantos candles cabem na tela
            const total = Math.floor((_width - AXIS_W) / (_candleW + _gap));
            
            // Permite um offset negativo para ver o "futuro" (margem direita vazia)
            const MIN_OFFSET = -30;
            _scrollOffset = Math.max(MIN_OFFSET, Math.min(Math.max(0, _candles.length - 3), _scrollOffset));
            
            _viewEnd   = _candles.length - 1 - _scrollOffset;
            _viewStart = Math.max(0, _viewEnd - total + 1);
            
            // Se o início bateu no zero, ajusta o fim para caber o máximo possível
            if (_viewStart === 0 && _candles.length > 0) {
                _viewEnd = Math.max(_viewEnd, Math.min(_candles.length - 1, total - 1));
            }
        },

        setCandleWidth(w) { _candleW = w; },

        scroll(candlesShift) {
            _scrollOffset += candlesShift;
            const MIN_OFFSET = -30;
            _scrollOffset = Math.max(MIN_OFFSET, Math.min(Math.max(0, _candles.length - 3), _scrollOffset));
        },

        resetScroll() {
            _scrollOffset = 0;
        },

        /**
         * Converte índice de candle para posição X central (alinhado à direita)
         * O uso de _viewEnd (que pode ser fracionário) garante scroll suave de pixels.
         * @param {number} idx
         */
        toX(idx) {
            const AXIS_W = 70;
            const chartW = _width - AXIS_W;
            const offsetFromEnd = _viewEnd - idx;
            return chartW - (offsetFromEnd * (_candleW + _gap)) - _candleW / 2;
        },

        getVisible() {
            // Usa Math.floor e Math.ceil para garantir que pega os candles fracionariamente visíveis nas bordas
            const startIdx = Math.max(0, Math.floor(_viewStart));
            const endIdx = Math.min(_candles.length - 1, Math.ceil(_viewEnd));
            return _candles.slice(startIdx, endIdx + 1);
        },

        get candleWidth() { return _candleW; },
        get gap()         { return _gap; },
        get viewStart()   { return _viewStart; },
        get visibleStart() { return Math.max(0, Math.floor(_viewStart)); },
        get viewEnd()     { return _viewEnd; },
        get scrollOffset() { return _scrollOffset; }
    };
})();

/* ============================================================
   EXPORTA NO NAMESPACE GLOBAL
   ============================================================ */
Object.assign(window.Z, { CandleBuilder, PriceScale, TimeScale });

Logger.info('✅ Shared Utilities carregadas (web.cs.js)');
})();
