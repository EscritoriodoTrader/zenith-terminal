/**
 * chart.js — Motor de Renderização do Gráfico
 * Responsabilidade: Desenhar os candles, footprint, volume e atualizar a UI.
 * Depende de: web.dv.js, web.cs.js, WebSocket.js
 */

'use strict';

const ChartEngine = (() => {
    const { Dom, EventBus, Store, Logger, Fmt, CandleBuilder, PriceScale, TimeScale } = window.Z;

    // Referências DOM
    let _canvasMain, _canvasOver, _canvasVol, _priceAxis, _timeAxis;

    // Statusbar
    let _statusTicker, _statusPrice, _statusVar, _statusVol, _statusCandles, _statusTime;

    // Mapeamentos BlackArrow DOM
    let _chartTitleTicker, _chartTitlePeriod, _chartCandleOpen, _chartCandleHigh, _chartCandleLow, _chartCandleClose, _chartCandleVar, _candleWatchClock;

    // Contextos 2D
    let _ctxMain, _ctxOver, _ctxVol, _ctxTime;

    // Dimensões
    let _width = 0;
    let _height = 0;
    let _volHeight = 80;

    // Estado da UI
    let _needsRender = false;
    let _mouse = { x: -1, y: -1, inChart: false };

    // Novas Variáveis de Configuração de Toolbar
    let _chartMode = 'auto'; // 'auto', 'candle', 'footprint'
    let _mouseMode = 'crosshair'; // 'pointer', 'crosshair', 'hand'
    let _showGridLines = true;
    let _showVolumeChart = true;

    let _isDragging = false;
    let _dragStartX = 0;
    let _dragStartY = 0;
    let _dragStartOffset = 0;

    // Auto-scale: quando o usuário arrasta o eixo de preço manualmente, travar o auto-scale
    let _priceScaleLocked = false;
    let _lastPrice = null; // Último preço recebido via WebSocket (para linha do preço atual)

    let _activeDropdown = null;

    // Tabela de tick sizes por ativo (igual à BlackArrow)
    const TICK_SIZES = {
        'NQ': 0.25, 'ES': 0.25, 'MNQ': 0.25, 'MES': 0.25,
        'RTY': 0.10, 'MRY': 0.10, 'YM': 1.0, 'MYM': 1.0,
        'GC': 0.10, 'MGC': 0.10, 'SI': 0.005, 'CL': 0.01,
        'ZB': 0.015625, 'ZN': 0.015625, 'ZF': 0.0078125,
        'EUR': 0.00005, 'GBP': 0.00005, 'JPY': 0.0000001,
        'BTC': 5.0, 'ETH': 0.05,
        'WIN': 5.0, 'IND': 5.0, 'WDO': 0.5, 'DOL': 0.5,
        'default': 0.01
    };

    function _getTickSize(ticker) {
        if (!ticker) return TICK_SIZES['default'];
        const tk = ticker.toUpperCase();
        // Tenta match exato, depois prefixo de 2-3 chars
        if (TICK_SIZES[tk]) return TICK_SIZES[tk];
        for (const [key, ts] of Object.entries(TICK_SIZES)) {
            if (key !== 'default' && tk.startsWith(key)) return ts;
        }
        return TICK_SIZES['default'];
    }

    function _updateCursor() {
        if (!_canvasOver) return;
        if (_mouseMode === 'pointer') {
            _canvasOver.style.cursor = 'default';
        } else if (_mouseMode === 'crosshair') {
            _canvasOver.style.cursor = 'crosshair';
        } else if (_mouseMode === 'hand') {
            _canvasOver.style.cursor = _isDragging ? 'grabbing' : 'grab';
        }
    }

    function _showDropdown(triggerEl, options, activeValue, onSelect) {
        if (_activeDropdown) {
            _activeDropdown.remove();
            _activeDropdown = null;
        }

        const dropdown = document.createElement('div');
        dropdown.className = 'zenith-dropdown';

        options.forEach(opt => {
            const item = document.createElement('div');
            item.className = `zenith-dropdown-item${opt.value === activeValue ? ' active' : ''}`;
            item.textContent = opt.label;

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                onSelect(opt.value);
                dropdown.remove();
                _activeDropdown = null;
            });

            dropdown.appendChild(item);
        });

        document.body.appendChild(dropdown);
        _activeDropdown = dropdown;

        const rect = triggerEl.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;

        dropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    /* ----------------------------------------------------------
       INICIALIZAÇÃO
     ---------------------------------------------------------- */
    function init() {
        // Injeta estilos elegantes do dropdown Zenith
        if (!document.getElementById('zenith-dropdown-styles')) {
            const dropdownStyle = document.createElement('style');
            dropdownStyle.id = 'zenith-dropdown-styles';
            dropdownStyle.innerHTML = `
                .zenith-dropdown {
                    position: absolute;
                    background: #141b24;
                    border: 1px solid #2c3a4a;
                    border-radius: 4px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.6);
                    z-index: 10000;
                    min-width: 140px;
                    padding: 4px 0;
                    font-family: "Segoe UI", sans-serif;
                }
                .zenith-dropdown-item {
                    padding: 8px 14px;
                    color: #c5ced6;
                    font-size: 12px;
                    cursor: pointer;
                    transition: background 0.15s, color 0.15s;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }
                .zenith-dropdown-item:hover {
                    background: #202d3d;
                    color: #ffffff;
                }
                .zenith-dropdown-item.active {
                    color: #22e57d;
                    font-weight: bold;
                }
                .zenith-dropdown-item.active::after {
                    content: "✓";
                    font-size: 10px;
                    color: #22e57d;
                }
            `;
            document.head.appendChild(dropdownStyle);
        }

        // Injeta estilos premium da barra de ferramentas flutuante
        if (!document.getElementById('zenith-floating-toolbar-styles')) {
            const toolbarStyle = document.createElement('style');
            toolbarStyle.id = 'zenith-floating-toolbar-styles';
            toolbarStyle.innerHTML = `
                #zenith-floating-toolbar {
                    position: absolute;
                    top: 45px;
                    left: 50%;
                    transform: translateX(-50%) translateY(-10px);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: rgba(19, 25, 36, 0.85);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border-radius: 8px;
                    padding: 5px 8px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                    z-index: 999;
                    user-select: none;
                    opacity: 0;
                    pointer-events: auto;
                    transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                #zenith-floating-toolbar::before {
                    content: '';
                    position: absolute;
                    top: -20px;
                    left: -20px;
                    right: -20px;
                    bottom: -20px;
                    z-index: -1;
                }
                #zenith-floating-toolbar:hover {
                    opacity: 1 !important;
                    transform: translateX(-50%) translateY(0) !important;
                }
                #zenith-floating-toolbar.hidden {
                    display: none !important;
                }
                /* Remove a barra de ferramentas lateral esquerda antiga */
                .graphic-study-bar {
                    display: none !important;
                }
                .zenith-floating-btn {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 6px;
                    color: #a9b0b7;
                    background: transparent;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    border: none;
                    outline: none;
                }
                .zenith-floating-btn:hover {
                    background: rgba(255, 255, 255, 0.08);
                    color: #ffffff;
                }
                .zenith-floating-btn.active {
                    background: rgba(34, 229, 125, 0.15) !important;
                    border: 1px solid rgba(34, 229, 125, 0.3) !important;
                    color: #22e57d !important;
                }
                .zenith-floating-btn svg {
                    width: 18px;
                    height: 18px;
                    fill: none;
                    stroke: currentColor;
                    stroke-width: 2;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                    flex-shrink: 0;
                }
            `;
            document.head.appendChild(toolbarStyle);
        }

        document.addEventListener('click', () => {
            if (_activeDropdown) {
                _activeDropdown.remove();
                _activeDropdown = null;
            }
        });

        // Inicializa referências DOM lazily após o carregamento completo do DOM
        _canvasMain = Dom.$('#canvas-main');
        _canvasOver = Dom.$('#canvas-overlay');
        _canvasVol = Dom.$('#canvas-volume');

        // Se o canvas ainda não foi renderizado pelo Vue, agenda nova tentativa em 100ms
        if (!_canvasMain || !_canvasOver || !_canvasVol) {
            setTimeout(init, 100);
            return;
        }

        // ── CRIAÇÃO DA BARRA DE FERRAMENTAS FLUTUANTE NO MEIO DO GRÁFICO ──
        if (!document.getElementById('zenith-floating-toolbar')) {
            const toolbar = document.createElement('div');
            toolbar.id = 'zenith-floating-toolbar';
            toolbar.innerHTML = `
                <button class="zenith-floating-btn" id="btn-floating-crosshair" title="Cruz (Crosshair)">
                    <svg viewBox="0 0 24 24">
                        <line x1="12" y1="2" x2="12" y2="22"></line>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                    </svg>
                </button>
                <button class="zenith-floating-btn" id="btn-floating-hand" title="Mão (Hand/Drag)">
                    <svg viewBox="0 0 24 24">
                        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v3"></path>
                        <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6"></path>
                        <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path>
                        <path d="M6 14a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6a7 7 0 0 0 7 7h5a7 7 0 0 0 7-7v-3"></path>
                    </svg>
                </button>
            `;

            // Adiciona no container principal do gráfico
            const container = document.getElementById('graphic-manager-content');
            if (container) {
                container.appendChild(toolbar);
            }

            // Event Listeners para os botões da barra flutuante
            const btnCross = document.getElementById('btn-floating-crosshair');
            const btnHand = document.getElementById('btn-floating-hand');

            btnCross?.addEventListener('click', (e) => {
                e.stopPropagation();
                Store.set('mouseMode', 'crosshair');
            });

            btnHand?.addEventListener('click', (e) => {
                e.stopPropagation();
                Store.set('mouseMode', 'hand');
            });
        }

        _priceAxis = Dom.$('#price-axis');
        _timeAxis = Dom.$('#time-axis');

        _statusTicker = Dom.$('#status-ticker');
        _statusPrice = Dom.$('#status-price');
        _statusVar = Dom.$('#status-var');
        _statusVol = Dom.$('#status-vol');
        _statusCandles = Dom.$('#status-candles');
        _statusTime = Dom.$('#status-time');

        _chartTitleTicker = Dom.$('#chart-title-ticker');
        _chartTitlePeriod = Dom.$('#chart-title-period');
        _chartCandleOpen = Dom.$('#chart-candle-open');
        _chartCandleHigh = Dom.$('#chart-candle-high');
        _chartCandleLow = Dom.$('#chart-candle-low');
        _chartCandleClose = Dom.$('#chart-candle-close');
        _chartCandleVar = Dom.$('#chart-candle-var');
        _candleWatchClock = Dom.$('#candle-watch-clock');

        _ctxMain = _canvasMain.getContext('2d');
        _ctxOver = _canvasOver.getContext('2d');
        _ctxVol = _canvasVol.getContext('2d');

        // Canvas nativo do eixo de tempo (BlackArrow engine canvas)
        if (_timeAxis && _timeAxis.tagName === 'CANVAS') {
            _ctxTime = _timeAxis.getContext('2d');
        }

        _bindEvents();
        _setupResize();

        // Define Ativo e Período Padrão caso não estejam no Store (Paridade BlackArrow)
        if (!Store.get('activeAsset')) {
            Store.set('activeAsset', { ticker: 'NQFUT', desc: 'Micro E-mini Nasdaq-100 Index Futures', exch: 'CME' });
        }
        if (!Store.get('activePeriod') || Store.get('activePeriod') === '1') {
            Store.set('activePeriod', '1Min');
        }

        // Inicializa visualmente os títulos do ativo e período para sincronia correta pós-reload
        const initialAsset = Store.get('activeAsset');
        if (initialAsset?.ticker) {
            if (_statusTicker) _statusTicker.textContent = initialAsset.ticker;
            if (_chartTitleTicker) _chartTitleTicker.textContent = initialAsset.ticker;
            PriceScale.setTickSize(_getTickSize(initialAsset.ticker));
            Logger.debug(`[Chart] Tick inicial: ${initialAsset.ticker} → ${PriceScale.tickSize}`);
        }

        const initialPeriod = Store.get('activePeriod');
        if (initialPeriod) {
            const cleanP = initialPeriod.replace('Min', '').replace('Diário', 'D');
            CandleBuilder.setPeriod(cleanP);
            if (_chartTitlePeriod) _chartTitlePeriod.textContent = initialPeriod;
            const periodText = Dom.$('#toolbar-period-text');
            if (periodText) periodText.textContent = initialPeriod;
        }

        // ── WATCHER DO MOUSE MODE E DEFINIÇÃO DO WINDOW.VUE / VLUE ──
        if (!Store.get('mouseMode')) {
            Store.set('mouseMode', 'crosshair');
        }

        Store.watch('mouseMode', (mode) => {
            _mouseMode = mode;
            _updateCursor();
            _requestRender();

            // Sincroniza os botões da barra flutuante
            const btnCross = document.getElementById('btn-floating-crosshair');
            const btnHand = document.getElementById('btn-floating-hand');
            if (btnCross) btnCross.classList.toggle('active', mode === 'crosshair');
            if (btnHand) btnHand.classList.toggle('active', mode === 'hand');

            // Sincroniza a barra lateral de estudos (study-bar)
            const studyBarItems = Dom.$$('.study-bar-item');
            studyBarItems.forEach((item, idx) => {
                item.classList.remove('study-bar-item--selected');
                if (idx === 1 && mode === 'crosshair') item.classList.add('study-bar-item--selected');
                if (idx === 2 && mode === 'hand') item.classList.add('study-bar-item--selected');
            });
        });

        // Força sincronização inicial
        const initialMode = Store.get('mouseMode') || 'crosshair';
        const bCross = document.getElementById('btn-floating-crosshair');
        const bHand = document.getElementById('btn-floating-hand');
        if (bCross) bCross.classList.toggle('active', initialMode === 'crosshair');
        if (bHand) bHand.classList.toggle('active', initialMode === 'hand');

        // Atalho global window.vue / window.vlue solicitado pelo usuário
        window.vue = {
            setMode(mode) {
                if (mode === 'hand' || mode === 'crosshair' || mode === 'pointer') {
                    Store.set('mouseMode', mode);
                    Logger.info(`🖱️ Modo de mouse alterado via window.vue/vlue para: ${mode}`);
                } else {
                    Logger.warn(`⚠️ Modo inválido para window.vue/vlue: ${mode}`);
                }
            },
            getMode() {
                return Store.get('mouseMode') || 'crosshair';
            },
            show() {
                const tb = document.getElementById('zenith-floating-toolbar');
                if (tb) tb.classList.remove('hidden');
                Logger.info('👁️ Barra flutuante exibida via window.vue/vlue');
            },
            hide() {
                const tb = document.getElementById('zenith-floating-toolbar');
                if (tb) tb.classList.add('hidden');
                Logger.info('🙈 Barra flutuante ocultada via window.vue/vlue');
            },
            toggle() {
                const tb = document.getElementById('zenith-floating-toolbar');
                if (tb) {
                    const isHidden = tb.classList.contains('hidden');
                    tb.classList.toggle('hidden', !isHidden);
                    Logger.info(`🔄 Barra flutuante alternada via window.vue/vlue`);
                }
            }
        };
        window.vlue = window.vue; // Tratamento defensivo de typo "vlue"

        // Loop de renderização otimizado
        requestAnimationFrame(_renderLoop);

        // Relógio da Statusbar
        setInterval(() => {
            _statusTime.textContent = Fmt.time(Date.now());
        }, 1000);

        // Countdown do Candle Watcher — usa ts do candle aberto (BlackArrow original)
        setInterval(() => {
            if (!_candleWatchClock) return;
            const activeP = Store.get('activePeriod') || '1Min';
            if (activeP.endsWith('P')) {
                _candleWatchClock.textContent = activeP;
                return;
            }
            const allC = CandleBuilder.getAll();
            const periodMs = (() => {
                const n = parseInt(activeP);
                return isNaN(n) ? 60000 : n * 60000;
            })();
            const now = Date.now();
            const lastCandle = allC.length > 0 ? allC[allC.length - 1] : null;
            let remaining;
            if (lastCandle && lastCandle.ts) {
                const nextClose = lastCandle.ts + periodMs;
                remaining = Math.max(0, Math.round((nextClose - now) / 1000));
            } else {
                remaining = periodMs / 1000 - (Math.floor(now / 1000) % (periodMs / 1000));
            }
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            _candleWatchClock.textContent = m > 0
                ? `${m}m${String(s).padStart(2, '0')}s`
                : `${s}s`;
        }, 1000);
    }

    function _setupResize() {
        const resize = () => {
            const rect = _canvasMain.parentElement.getBoundingClientRect();
            _width = rect.width;
            _height = rect.height;

            // Ajusta dimensões dos canvases — SEMPRE reseta o transform antes de escalar
            // Evita acumulação de DPR ao chamar .scale() múltiplas vezes
            const setSize = (cvs, w, h) => {
                const dpr = window.devicePixelRatio || 1;
                cvs.width = Math.round(w * dpr);
                cvs.height = Math.round(h * dpr);
                cvs.style.width = `${w}px`;
                cvs.style.height = `${h}px`;
                const ctx = cvs.getContext('2d');
                ctx.setTransform(1, 0, 0, 1, 0, 0); // reseta qualquer transform acumulado
                ctx.scale(dpr, dpr);
            };

            setSize(_canvasMain, _width, _height);
            setSize(_canvasOver, _width, _height);
            setSize(_canvasVol, _width, _volHeight);

            _requestRender();
        };

        window.addEventListener('resize', resize);
        resize();
    }

    function _bindEvents() {
        // ══ SISTEMA DE DRAG E SCROLL — delegação no document com capture ══
        let _dragDidMove = false;   // distingue click simples de drag real
        const DRAG_THRESHOLD = 5;  // pixels mínimos para considerar drag
        const AXIS_PRICE_W = 70;   // largura da régua de preço (rightmost area)

        // Estado do drag de preço (régua de preço direita)
        let _priceDragging = false;
        let _priceDragStartY = 0;
        let _priceDragMinP = 0;
        let _priceDragMaxP = 0;
        let _priceDragRangeH = 0;

        // ── POINTERDOWN UNIFICADO: decide entre drag de preço ou navegação ──
        // Detecta a zona de clique: se nos últimos AXIS_PRICE_W px = régua de preço
        document.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.button !== 1) return;
            const overlay = document.getElementById('canvas-overlay');
            if (!overlay) return;

            // Verifica se clicou diretamente no canvas-overlay
            if (e.target?.id !== 'canvas-overlay') return;

            const rect = overlay.getBoundingClientRect();
            const xInCanvas = e.clientX - rect.left;

            // ── Zona da régua de preço (rightmost AXIS_PRICE_W px) ──
            if (xInCanvas >= rect.width - AXIS_PRICE_W) {
                _priceDragging = true;
                _isDragging = false;
                _priceDragStartY = e.clientY;
                _priceDragMinP = PriceScale.min;
                _priceDragMaxP = PriceScale.max;
                _priceDragRangeH = (_priceDragMaxP - _priceDragMinP) || 1;
                _priceScaleLocked = true;
                overlay.style.cursor = 'ns-resize';
                try { overlay.setPointerCapture(e.pointerId); } catch (_) { }
                e.preventDefault();
                return;
            }

            // ── Zona do gráfico (área de candles) ──
            _isDragging = true;
            _dragDidMove = false;
            _dragStartX = e.clientX;
            _dragStartY = e.clientY;
            try { overlay.setPointerCapture(e.pointerId); } catch (_) { }
            // Não chama preventDefault — permite que cliques simples funcionem
        }, { capture: true });

        // ── POINTERMOVE: atualiza crosshair, drag de navegação e drag de preço ──
        document.addEventListener('pointermove', (e) => {
            const overlay = document.getElementById('canvas-overlay');
            if (overlay) {
                const rect = overlay.getBoundingClientRect();
                _mouse.x = e.clientX - rect.left;
                _mouse.y = e.clientY - rect.top;
                _mouse.inChart = (
                    _mouse.x >= 0 && _mouse.x <= rect.width &&
                    _mouse.y >= 0 && _mouse.y <= rect.height
                );

                // Atualiza visibilidade da barra de ferramentas flutuante baseada em hover inteligente
                _updateFloatingToolbarVisibility(_mouse.x, _mouse.y, rect);

                // Cursor ns-resize quando sobre a régua de preço (sem drag ativo)
                if (!_isDragging && !_priceDragging && _mouse.inChart) {
                    if (_mouse.x >= rect.width - AXIS_PRICE_W) {
                        overlay.style.cursor = 'ns-resize';
                    } else {
                        _updateCursor();
                    }
                }
            }

            // ─ Drag de navegação (area de candles) ─
            if (_isDragging) {
                if (!_dragDidMove) {
                    const dist = Math.max(Math.abs(e.clientX - _dragStartX), Math.abs(e.clientY - _dragStartY));
                    if (dist >= DRAG_THRESHOLD) {
                        _dragDidMove = true;
                        _updateCursor();
                    }
                }

                if (_dragDidMove) {
                    const dx = e.clientX - _dragStartX;
                    const dy = e.clientY - _dragStartY;
                    _dragStartX = e.clientX;
                    _dragStartY = e.clientY;

                    // Scroll fracionário suave para X
                    const candleStep = TimeScale.candleWidth + TimeScale.gap;
                    const shiftX = dx / candleStep;
                    if (shiftX !== 0) {
                        TimeScale.scroll(shiftX);
                    }

                    // Se a ferramenta for 'Mão', permite arrastar o eixo de preço (Y) também
                    if (_mouseMode === 'hand') {
                        if (dy !== 0) {
                            const priceShift = PriceScale.toPrice(_dragStartY) - PriceScale.toPrice(_dragStartY + dy);
                            PriceScale.setRange(PriceScale.min + priceShift, PriceScale.max + priceShift, _height - _volHeight);
                            _priceScaleLocked = true; // Trava o auto-scale
                        }
                    }

                    // O render chamará TimeScale.setData automaticamente
                    _requestRender();
                }
            }

            // ─ Drag de escala de preço (régua direita) ─
            if (_priceDragging) {
                const dy = e.clientY - _priceDragStartY;
                const factor = 1 + dy * 0.004;
                const center = (_priceDragMinP + _priceDragMaxP) / 2;
                const halfRange = (_priceDragRangeH / 2) * Math.max(0.05, factor);
                PriceScale.setRange(center - halfRange, center + halfRange, _height - _volHeight);
                _requestRender();
            }

            if (!_isDragging && !_priceDragging && _mouse.inChart) {
                _requestRender();
            }
        }, { capture: true });

        // ── POINTERUP / CANCEL: finaliza ambos os tipos de drag ──
        const stopDrag = (e) => {
            if (_isDragging) {
                _isDragging = false;
                _dragDidMove = false;
                try {
                    const overlay = document.getElementById('canvas-overlay');
                    if (overlay && e?.pointerId != null) overlay.releasePointerCapture(e.pointerId);
                } catch (_) { }
                _updateCursor();
                _requestRender();
            }
            if (_priceDragging) {
                _priceDragging = false;
                _updateCursor();
                _requestRender();
            }
        };
        document.addEventListener('pointerup', stopDrag, { capture: true });
        document.addEventListener('pointercancel', stopDrag, { capture: true });

        // Mouse sai do chart
        if (_canvasOver) {
            _canvasOver.addEventListener('mouseleave', () => {
                if (!_isDragging) {
                    _mouse.inChart = false;
                    _requestRender();
                }
                // Oculta a barra flutuante imediatamente se o mouse sair do chart
                const toolbar = document.getElementById('zenith-floating-toolbar');
                if (toolbar) {
                    toolbar.style.opacity = '0';
                    toolbar.style.transform = 'translateX(-50%) translateY(-10px)';
                    toolbar.style.pointerEvents = 'none';
                }
            });
        }

        // ── DBLCLICK: clique duplo na régua de preço destrava a escala e retorna ao Auto-Fit ──
        document.addEventListener('dblclick', (e) => {
            const overlay = document.getElementById('canvas-overlay');
            if (!overlay || e.target?.id !== 'canvas-overlay') return;
            const rect = overlay.getBoundingClientRect();
            const xInCanvas = e.clientX - rect.left;

            if (xInCanvas >= rect.width - AXIS_PRICE_W) {
                _priceScaleLocked = false;
                Logger.info('🔓 Escala de preço redefinida para Auto-Scale!');
                _requestRender();
            }
        }, { capture: true });

        // ── WHEEL: scroll normal = navegar; Ctrl+Scroll = zoom horizontal ──
        document.addEventListener('wheel', (e) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (el?.id !== 'canvas-overlay') return;
            e.preventDefault();
            e.stopPropagation();
            const rawDelta = e.deltaMode === 1 ? e.deltaY * 40 :
                e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
            if (e.ctrlKey) {
                const delta = rawDelta < 0 ? 1.25 : 0.8;
                const newW = Math.min(240, Math.max(4, Math.round(TimeScale.candleWidth * delta)));
                if (newW !== TimeScale.candleWidth) { TimeScale.setCandleWidth(newW); _requestRender(); }
            } else {
                TimeScale.setData(CandleBuilder.getAll(), _width);
                TimeScale.scroll(rawDelta > 0 ? 3 : -3);
                _requestRender();
            }
        }, { passive: false, capture: true });

        // ── Drag de preço e cursor ns-resize são tratados no pointermove/pointerup unificados acima ──

        // ----------------------------------------------------
        // BINDINGS PARA A TOOLBAR SUPERIOR DO GRÁFICO
        // ----------------------------------------------------

        // 1. Pencil / Drawing Sidebar Toggle
        const pencilBtn = Dom.$('#btn-draw-sidebar-toggle');
        pencilBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const sidebar = Dom.$('.study-bar');
            if (sidebar) {
                const isHidden = sidebar.classList.contains('hidden');
                sidebar.classList.toggle('hidden', !isHidden);
                pencilBtn.classList.toggle('active', isHidden);
            }
        });

        // 2. Period selector dropdown
        const periodSelector = Dom.$('#toolbar-period-selector');
        periodSelector?.addEventListener('click', (e) => {
            e.stopPropagation();
            _showDropdown(periodSelector, [
                { label: '1 Minuto', value: '1Min' },
                { label: '2 Minutos', value: '2Min' },
                { label: '3 Minutos', value: '3Min' },
                { label: '5 Minutos', value: '5Min' },
                { label: '15 Minutos', value: '15Min' },
                { label: '30 Minutos', value: '30Min' },
                { label: '60 Minutos', value: '60Min' },
                { label: '1 Ponto (1P)', value: '1P' },
                { label: '2 Pontos (2P)', value: '2P' },
                { label: '3 Pontos (3P)', value: '3P' },
                { label: '5 Pontos (5P)', value: '5P' },
                { label: '10 Pontos (10P)', value: '10P' },
                { label: '20 Pontos (20P)', value: '20P' },
                { label: '50 Pontos (50P)', value: '50P' }
            ], Store.get('activePeriod') || '1Min', (val) => {
                TimeScale.resetScroll();
                CandleBuilder.setPeriod(val.replace('Min', ''));
                Store.set('activePeriod', val);
            });
        });

        // 2.5 Toggle da barra de ferramentas (Botão Relógio no Topo esquerdo)
        document.addEventListener('click', (e) => {
            const btnToggleMainToolbar = e.target.closest?.('.left-side-icon');
            if (btnToggleMainToolbar) {
                const graphicHeader = Dom.$('.graphic-header');
                if (graphicHeader) {
                    if (graphicHeader.style.display === 'none') {
                        graphicHeader.style.setProperty('display', 'flex', 'important');
                    } else {
                        graphicHeader.style.setProperty('display', 'none', 'important');
                    }
                    // Força o resize do canvas para recalcular e preencher o espaço
                    window.dispatchEvent(new Event('resize'));
                }
            }
        }, { capture: true });

        // 3. Automático (Zoom / Candle / Footprint) Dropdown
        const autoSelector = Dom.$('#toolbar-auto-selector');
        autoSelector?.addEventListener('click', (e) => {
            e.stopPropagation();
            _showDropdown(autoSelector, [
                { label: 'Automático (Zoom)', value: 'auto' },
                { label: 'Apenas Candles', value: 'candle' },
                { label: 'Apenas Footprint', value: 'footprint' }
            ], _chartMode, (val) => {
                _chartMode = val;
                const autoText = Dom.$('#toolbar-auto-selector .text');
                if (autoText) {
                    if (val === 'auto') autoText.textContent = 'Automático';
                    else if (val === 'candle') autoText.textContent = 'Candles';
                    else if (val === 'footprint') autoText.textContent = 'Footprint';
                }
                _requestRender();
            });
        });

        // 4. Indicadores Dropdown (Garante chamada ao modal nativo de Lupa)
        const indSelector = Dom.$('#toolbar-indicators-selector');
        indSelector?.addEventListener('click', (e) => {
            e.stopPropagation();
            window.Z.Lupa?.open();
        });

        // 5. Visibilidade (Grade / Volume) Dropdown
        const visSelector = Dom.$('#toolbar-visibility-selector');
        visSelector?.addEventListener('click', (e) => {
            e.stopPropagation();
            _showDropdown(visSelector, [
                { label: (_showGridLines ? '☒' : '☐') + ' Grade', value: 'grid' },
                { label: (_showVolumeChart ? '☒' : '☐') + ' Volume', value: 'volume' }
            ], '', (val) => {
                if (val === 'grid') {
                    _showGridLines = !_showGridLines;
                } else if (val === 'volume') {
                    _showVolumeChart = !_showVolumeChart;
                    _volHeight = _showVolumeChart ? 80 : 0;
                    // Força recálculo das dimensões
                    window.dispatchEvent(new Event('resize'));
                }
                _requestRender();
            });
        });

        // 6 & 7. Zoom In / Out — fase de CAPTURA para contornar stopPropagation do Vue
        document.addEventListener('click', (e) => {
            const zoomIn = e.target.closest?.('#btn-zoom-in');
            const zoomOut = e.target.closest?.('#btn-zoom-out');
            if (!zoomIn && !zoomOut) return;
            // Não interrompe propagação — deixa o Vue processar também
            const curW = TimeScale.candleWidth;
            if (zoomIn) {
                const newW = Math.min(240, Math.round(curW * 1.25));
                if (newW !== curW) { TimeScale.setCandleWidth(newW); _requestRender(); }
                Logger.debug(`🔍+ Zoom in: ${curW} → ${newW}px`);
            } else {
                const newW = Math.max(4, Math.round(curW / 1.25));
                if (newW !== curW) { TimeScale.setCandleWidth(newW); _requestRender(); }
                Logger.debug(`🔍- Zoom out: ${curW} → ${newW}px`);
            }
        }, { capture: true }); // capture = intercepta antes do stopPropagation do Vue


        // 8. Template Mode Switch
        const btnTemplate = Dom.$('#btn-template-switch');
        btnTemplate?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_chartMode === 'auto') _chartMode = 'candle';
            else if (_chartMode === 'candle') _chartMode = 'footprint';
            else _chartMode = 'auto';
            const autoText = Dom.$('#toolbar-auto-selector .text');
            if (autoText) {
                if (_chartMode === 'auto') autoText.textContent = 'Automático';
                else if (_chartMode === 'candle') autoText.textContent = 'Candles';
                else if (_chartMode === 'footprint') autoText.textContent = 'Footprint';
            }
            _requestRender();
        });

        // 9. Toggle da Régua de Preço — mostra/oculta o eixo de preço direito
        let _showPriceScale = true;
        const btnPriceScaleToggle = Dom.$('#btn-price-scale-toggle');
        if (btnPriceScaleToggle) {
            btnPriceScaleToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                _showPriceScale = !_showPriceScale;
                // Oculta/exibe o eixo de preço ajustando a largura do CSS var
                const container = Dom.$('.graphic-content-container');
                if (container) {
                    container.style.setProperty(
                        '--graphic-price-scale-width',
                        _showPriceScale ? '68px' : '0px'
                    );
                }
                btnPriceScaleToggle.style.opacity = _showPriceScale ? '1' : '0.4';
                window.dispatchEvent(new Event('resize'));
                _requestRender();
                Logger.debug(`[Chart] Régua de preço: ${_showPriceScale ? 'visível' : 'oculta'}`);
            });
        }

        // 10. Double-click no canvas = ir para o candle mais recente (reset posição)
        document.addEventListener('dblclick', (e) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (el?.id !== 'canvas-overlay') return;
            TimeScale.resetScroll();
            TimeScale.setData(CandleBuilder.getAll(), _width);
            _priceScaleLocked = false; // Resetar auto-scale também
            _requestRender();
            Logger.debug('[Chart] Double-click: voltando ao candle mais recente + auto-scale reset');
        }, { capture: true });

        // ----------------------------------------------------
        // BINDINGS PARA A BARRA DE ESTUDOS (SIDEBAR ESQUERDA)
        // ----------------------------------------------------
        const studyBarItems = Dom.$$('.study-bar-item');
        studyBarItems.forEach((item, idx) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (idx === 0) {
                    Store.set('mouseMode', 'pointer');
                } else if (idx === 1) {
                    Store.set('mouseMode', 'crosshair');
                } else if (idx === 2) {
                    Store.set('mouseMode', 'hand');
                }
            });
        });

        // Eventos do Store/WS
        Store.watch('activeAsset', (asset) => {
            if (!asset) return;
            _statusTicker.textContent = asset.ticker;
            if (_chartTitleTicker) _chartTitleTicker.textContent = asset.ticker;

            // Atualiza dinamicamente a bolsa (Exchange)
            const exchangeEl = Dom.$('#chart-title-exchange');
            if (exchangeEl) {
                exchangeEl.textContent = asset.exch || 'CME';
            }

            // Atualiza tick size do ativo no PriceScale
            const ts = _getTickSize(asset.ticker);
            PriceScale.setTickSize(ts);
            _priceScaleLocked = false; // Resetar lock ao trocar ativo

            // Reseta o construtor de velas sincronamente para evitar resíduos visuais do ativo antigo
            CandleBuilder.reset();
            _lastPrice = null; // Reseta o preço atual para carregar do novo ativo/histórico
            Logger.debug(`[Chart] Ativo: ${asset.ticker} | Tick: ${ts}`);
        });

        Store.watch('activePeriod', (period) => {
            if (!period) return;

            // Garante que o construtor de velas esteja sincronizado com o período do Store
            const cleanP = period.replace('Min', '').replace('Diário', 'D');
            CandleBuilder.setPeriod(cleanP);

            if (_chartTitlePeriod) _chartTitlePeriod.textContent = period;
            const periodText = Dom.$('#toolbar-period-text');
            if (periodText) periodText.textContent = period;

            // Atualiza dinamicamente o ícone do período (Minutos vs Pontos)
            const periodIconContainer = Dom.$('#toolbar-period-selector .icon');
            if (periodIconContainer) {
                if (period.endsWith('P')) {
                    periodIconContainer.innerHTML = `<img src="images/dark_point.png" style="width: 14px; height: 14px; display: block;" />`;
                } else {
                    periodIconContainer.innerHTML = `<img src="images/dark_minute.png" style="width: 14px; height: 14px; display: block;" />`;
                }
            }

            // Recarrega o histórico do ativo ativo para reconstruir os candles com o novo período
            const activeAsset = Store.get('activeAsset');
            if (activeAsset) {
                if (activeAsset.ticker === 'HISTORICO') {
                    window.Z.DataBridge?.reloadHistory();
                } else {
                    window.Z.DataBridge?.loadHistoryFromDb(activeAsset.ticker);
                }
            }
        });

        EventBus.on('ws:newData', ({ asset, lastPrice, variation }) => {
            const activeAsset = Store.get('activeAsset');
            if (activeAsset && asset && asset !== 'HISTORICO') {
                const activeTicker = activeAsset.ticker || activeAsset;
                
                const clean = (name) => {
                    let n = String(name).toUpperCase().replace(/_M_\d+$/, '').trim();
                    if (n.startsWith('WIN') || n.startsWith('IND')) return 'WIN';
                    if (n.startsWith('DOL') || n.startsWith('WDO')) return 'DOL';
                    if (n.startsWith('NQ')) return 'NQ';
                    if (n.startsWith('ES')) return 'ES';
                    return n;
                };

                if (clean(asset) !== clean(activeTicker)) {
                    // Ignora pacotes de dados de outros ativos para o gráfico principal
                    return;
                }
            }

            // Validação Cruzada por Faixa de Preço no Gráfico
            if (activeAsset && lastPrice > 0) {
                const normActive = String(activeAsset.ticker || activeAsset).toUpperCase();
                if (normActive.includes('NQ') && lastPrice < 12000) return;
                if (normActive.includes('ES') && lastPrice > 12000) return;
            }

            if (lastPrice) {
                _lastPrice = typeof lastPrice === 'number' ? lastPrice : parseFloat(lastPrice); // Armazena para linha do preço atual
                _statusPrice.textContent = Fmt.price(_lastPrice);
                _statusPrice.className = `status-item text-mono ${variation > 0 ? 'text-buy' : variation < 0 ? 'text-sell' : ''}`;
                _requestRender();
            }
            if (variation !== undefined) {
                _statusVar.textContent = Fmt.variation(variation);
                _statusVar.className = `status-item ${variation > 0 ? 'text-buy' : variation < 0 ? 'text-sell' : ''}`;
                const tabVar = Dom.$('#active-tab-var');
                if (tabVar) {
                    tabVar.textContent = Fmt.variation(variation);
                    tabVar.className = `pointer-events-none asset-tabs-component__variation ${variation > 0 ? 'positive' : variation < 0 ? 'negative' : ''}`;
                }
            }
        });

        EventBus.on('candle:update', () => _requestRender());
        EventBus.on('candle:closed', () => _requestRender());
        EventBus.on('candle:reset', () => _requestRender());

        // Alternância e Ciclo de Período ao clicar nos títulos/abas (Paridade BlackArrow)
        const cyclePeriods = ['1', '2', '3', '5', '15', '30', '60', '1P', '2P', '3P', '5P', '10P', '20P', '50P'];
        const updatePeriod = (p) => {
            const storeVal = p.endsWith('P') ? p : p + 'Min';
            Store.set('activePeriod', storeVal);
            CandleBuilder.setPeriod(p);

            // Recarrega se for histórico
            if (Store.get('activeAsset')?.ticker === 'HISTORICO') {
                window.Z.DataBridge?.reloadHistory();
            } else {
                window.Z.DataBridge?.clearChart();
            }
        };

        _chartTitlePeriod?.addEventListener('click', () => {
            const cur = Store.get('activePeriod') || '1Min';
            const curNum = cur.endsWith('P') ? cur : cur.replace('Min', '');
            let nextIdx = cyclePeriods.indexOf(curNum) + 1;
            if (nextIdx <= 0 || nextIdx >= cyclePeriods.length) nextIdx = 0;
            updatePeriod(cyclePeriods[nextIdx]);
        });

        Dom.$('#active-tab-period')?.addEventListener('click', () => {
            const cur = Store.get('activePeriod') || '1Min';
            const curNum = cur.endsWith('P') ? cur : cur.replace('Min', '');
            let nextIdx = cyclePeriods.indexOf(curNum) + 1;
            if (nextIdx <= 0 || nextIdx >= cyclePeriods.length) nextIdx = 0;
            updatePeriod(cyclePeriods[nextIdx]);
        });
    }

    /* ----------------------------------------------------------
       RENDERIZAÇÃO
    ---------------------------------------------------------- */
    function _requestRender() {
        _needsRender = true;
    }

    function _renderLoop() {
        if (_needsRender) {
            try {
                _render();
            } catch (err) {
                console.error('[ChartEngine] Erro no _render():', err);
            }
            _needsRender = false;
        }
        requestAnimationFrame(_renderLoop);
    }

    function _render() {
        // 1. Pega dados e ajusta escalas
        const allCandles = CandleBuilder.getAll();
        _statusCandles.textContent = `${allCandles.length} candles`;

        let totalVol = 0;
        let maxVol = 0;
        let minP = Infinity, maxP = -Infinity;

        TimeScale.setData(allCandles, _width);
        const visible = TimeScale.getVisible();

        visible.forEach(c => {
            if (c.high > maxP) maxP = c.high;
            if (c.low < minP) minP = c.low;
            if (c.volume > maxVol) maxVol = c.volume;
            totalVol += c.volume;
        });

        _statusVol.textContent = `VOL ${Fmt.volume(totalVol)}`;

        // Só inicializa o _lastPrice se ele for nulo (para carregar o fechamento inicial do histórico)
        // Depois disso, o preço é guiado 100% dinamicamente pelos Informativos (ULT) via WebSocket
        if (_lastPrice === null && allCandles.length > 0) {
            _lastPrice = allCandles[allCandles.length - 1].close;
        }

        // Margens na escala de preço
        const CHART_H_FOR_PRICE = _height - _volHeight;
        if (!_priceScaleLocked) {
            // Auto-scale: calcula range a partir dos candles visíveis + padding
            if (minP !== Infinity && maxP !== -Infinity) {
                const pad = (maxP - minP) * 0.12;
                PriceScale.setRange(minP - pad, maxP + pad, CHART_H_FOR_PRICE);
            } else {
                PriceScale.setRange(0, 100, CHART_H_FOR_PRICE);
            }
        } else {
            // Scale travada: apenas atualiza a altura do canvas (range mantido)
            PriceScale.setRange(PriceScale.min, PriceScale.max, CHART_H_FOR_PRICE);
        }

        // 2. Limpa Canvases (permitindo o fundo CSS transparente)
        _ctxMain.clearRect(0, 0, _width, _height);
        _ctxOver.clearRect(0, 0, _width, _height);
        _ctxVol.clearRect(0, 0, _width, _volHeight);

        // 2.1 Desenha Fundo Nativos dos Eixos (BlackArrow Parity)
        const AXIS_PRICE_W = 70;
        const AXIS_TIME_H = 35;

        // Fundo dos eixos removido para usar 100% o gradient do app.css

        // Borda separadora removida para layout seamless igual ao BlackArrow

        // 3. Desenha Grid e Eixos
        _drawGrid(AXIS_PRICE_W, AXIS_TIME_H);

        // 4. Desenha Elementos
        _drawCandles(visible, AXIS_PRICE_W, AXIS_TIME_H);
        _drawVolume(visible, maxVol, AXIS_PRICE_W, AXIS_TIME_H);

        // 4.1 Linha do preço atual + tag de preço (BlackArrow recentQuote)
        _drawLastPriceLine(AXIS_PRICE_W);

        _drawCrosshair(AXIS_PRICE_W, AXIS_TIME_H);

        // 5. Atualiza o painel de OHLV no topo do gráfico (BlackArrow original)
        let hoveredCandle = null;
        const chartW = _width - AXIS_PRICE_W;
        if (_mouse.inChart && _mouse.x >= 0 && _mouse.x < chartW) {
            let closestDist = Infinity;
            visible.forEach((c, idx) => {
                const x = TimeScale.toX(idx + TimeScale.visibleStart);
                const dist = Math.abs(x - _mouse.x);
                if (dist < closestDist) {
                    closestDist = dist;
                    hoveredCandle = c;
                }
            });
            if (closestDist > TimeScale.candleWidth * 1.5) {
                hoveredCandle = null;
            }
        }
        const activeCandle = hoveredCandle || (allCandles.length > 0 ? allCandles[allCandles.length - 1] : null);
        _updateOHLV(activeCandle);
    }

    function _drawGrid(axisPriceW, axisTimeH) {
        const chartW = _width - axisPriceW;
        const chartH = _height;
        const visible = TimeScale.getVisible();

        // ─── 1. Grid + Labels de Preço com tick-size alinhado ───
        _ctxMain.font = '11px "Segoe UI", sans-serif';
        _ctxMain.textAlign = 'right';
        _ctxMain.textBaseline = 'middle';

        const priceRange = PriceScale.max - PriceScale.min;
        // Só desenha a grade de preços se houver ativos visíveis (evita escala 0-100 fictícia)
        if (priceRange > 0 && visible.length > 0) {
            // Escolhe um passo do grid que gere ~10-15 linhas visíveis
            // Baseado no tick size do ativo para labels sempre "limpas"
            const tick = PriceScale.tickSize || 0.01;
            // Calcular targetLines baseado na altura (mínimo de ~25px entre preços)
            const MIN_LABEL_DIST_Y = 25;
            const targetLines = Math.max(4, chartH / MIN_LABEL_DIST_Y);

            const rawStep = priceRange / targetLines;
            // Arredonda rawStep para múltiplo do tick, escolhe escala mais próxima
            const scales = [1, 2, 2.5, 4, 5, 10, 20, 25, 40, 50, 100, 200, 250, 400, 500, 1000];
            let gridStep = tick;
            for (const s of scales) {
                const candidate = tick * s;
                if (candidate >= rawStep) { gridStep = candidate; break; }
            }
            if (gridStep === tick && rawStep > tick) gridStep = tick * 1000; // fallback

            // Primeiro nível acima do min
            const firstLevel = Math.ceil(PriceScale.min / gridStep) * gridStep;

            if (_showGridLines) {
                _ctxMain.strokeStyle = 'rgba(255,255,255,0.04)';
                _ctxMain.lineWidth = 1;
                _ctxMain.setLineDash([2, 4]);
                _ctxMain.beginPath();
            }

            for (let p = firstLevel; p <= PriceScale.max + gridStep * 0.01; p += gridStep) {
                const y = PriceScale.toY(p);
                if (y < -2 || y > chartH + 2) continue;

                if (_showGridLines) {
                    _ctxMain.moveTo(0, y);
                    _ctxMain.lineTo(chartW, y);
                }
                // Label de preço alinhado à direita no eixo de preço
                _ctxMain.fillStyle = '#848E9C';
                _ctxMain.fillText(Fmt.price(p), _width - 6, y);
            }

            if (_showGridLines) {
                _ctxMain.stroke();
                _ctxMain.setLineDash([]);
            }
        }

        // ─── 2. Eixo de Tempo no canvas #time-axis (canvas nativo BlackArrow) ───
        if (!_ctxTime || visible.length === 0) return;

        // Redimensiona o canvas de tempo se necessário
        const timeCanvas = _timeAxis;
        const availW = Math.round(_width - axisPriceW);
        if (timeCanvas.width !== availW || timeCanvas.height !== axisTimeH) {
            const dpr = window.devicePixelRatio || 1;
            timeCanvas.width = availW * dpr;
            timeCanvas.height = axisTimeH * dpr;
            timeCanvas.style.width = `${availW}px`;
            timeCanvas.style.height = `${axisTimeH}px`;
            _ctxTime.scale(dpr, dpr);
        }

        // ── Fundo azul-escuro estilo BlackArrow ──
        _ctxTime.clearRect(0, 0, availW, axisTimeH);
        _ctxTime.fillStyle = '#131722';
        _ctxTime.fillRect(0, 0, availW, axisTimeH);
        // Linha divisora 1px no topo
        _ctxTime.fillStyle = '#2B3A4A';
        _ctxTime.fillRect(0, 0, availW, 1);

        const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
        const minInterval = 60; // Reduzido para mostrar mais marcações de tempo
        let lastLabelX = -Infinity;
        let lastDay = -1;

        _ctxTime.textAlign = 'center';
        _ctxTime.textBaseline = 'top'; // Mudado para 'top' para evitar cortes de renderização



        visible.forEach((c, idx) => {
            const x = TimeScale.toX(idx + TimeScale.visibleStart);
            if (x < 0 || x > chartW) return;
            if (x - lastLabelX < minInterval) return;

            const d = new Date(c.ts || Date.now()); // fallback
            const day = d.getDate();
            const isFirstLabel = lastLabelX === -Infinity;
            const isNewDay = lastDay !== -1 && day !== lastDay;
            lastDay = day;
            lastLabelX = x;

            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');

            // ── 1. Desenha sempre a Hora (parte superior) ──
            _ctxTime.font = 'bold 11px Arial, sans-serif'; // Simplifiquei a fonte para evitar bug
            _ctxTime.fillStyle = '#E0E6ED';
            _ctxTime.fillText(`${hh}:${mm}`, x, 4);

            // ── 2. Desenha a Data abaixo da hora (quando mudar o dia ou no primeiro item) ──
            if (isNewDay || isFirstLabel) {
                const dd = String(d.getDate()).padStart(2, '0');
                const monthName = MONTHS_PT[d.getMonth()] || 'xxx';
                const dateLabel = `${dd}/${monthName}`;

                _ctxTime.font = '11px Arial, sans-serif';
                _ctxTime.fillStyle = '#848E9C';
                _ctxTime.fillText(dateLabel, x, 18);

                // linha vertical no gráfico marcando início do dia (apenas na virada)
                if (isNewDay && _showGridLines) {
                    _ctxMain.save();
                    _ctxMain.strokeStyle = 'rgba(180,200,230,0.12)';
                    _ctxMain.lineWidth = 1;
                    _ctxMain.setLineDash([3, 5]);
                    _ctxMain.beginPath();
                    _ctxMain.moveTo(x, 0);
                    _ctxMain.lineTo(x, chartH);
                    _ctxMain.stroke();
                    _ctxMain.setLineDash([]);
                    _ctxMain.restore();
                }
            }
        });
    }

    function _drawCandles(candles, axisPriceW, axisTimeH) {
        const w = TimeScale.candleWidth;
        const halfW = w / 2;

        candles.forEach((c, idx) => {
            const x = TimeScale.toX(idx + TimeScale.visibleStart);
            const isBull = c.close >= c.open;

            const isFootprint = _chartMode === 'footprint' || (_chartMode === 'auto' && w >= 45);
            if (isFootprint) {
                // MODO FOOTPRINT (Zoom Elevado)
                // ==========================================

                // 2. Desenha cada nível de preço (Footprint)
                const tick = PriceScale.tickSize || 0.5;
                const minPrice = PriceScale.snap(c.low);
                const maxPrice = PriceScale.snap(c.high);

                // Encontrar o POC (nível com maior volume) e o Max Abs Delta para escala das barras
                let pocPrice = minPrice;
                let maxVolLevel = 0;
                let maxAbsDelta = 0;
                for (let pLevel = minPrice; pLevel <= maxPrice; pLevel += tick) {
                    const data = c.levels.get(pLevel);
                    if (data) {
                        const vol = data.buy + data.sell;
                        if (vol > maxVolLevel) {
                            maxVolLevel = vol;
                            pocPrice = pLevel;
                        }
                        const delta = Math.abs(data.buy - data.sell);
                        if (delta > maxAbsDelta) {
                            maxAbsDelta = delta;
                        }
                    }
                }

                _ctxMain.font = 'bold 9px "Segoe UI", Monaco, monospace';
                _ctxMain.textBaseline = 'middle';

                for (let pLevel = minPrice; pLevel <= maxPrice; pLevel += tick) {
                    const yCenter = PriceScale.toY(pLevel);
                    const yLevelNext = PriceScale.toY(pLevel + tick);
                    const levelH = Math.abs(yCenter - yLevelNext);
                    const levelY = yCenter - levelH / 2;

                    const data = c.levels.get(pLevel) || { buy: 0, sell: 0 };
                    const vol = data.buy + data.sell;

                    // Desenha exclusivamente o layout triplo de 3 colunas solicitado:
                    // [ Saldo (35%) | Quantidade (30%) | Barra de Volume baseada no Saldo (35%) ]
                    const col1Width = w * 0.35;
                    const col2Width = w * 0.30;
                    const col3Width = w * 0.35;

                    const xStart = x - halfW;
                    const x1 = xStart;
                    const x2 = xStart + col1Width;
                    const x3 = xStart + col1Width + col2Width;

                    if (vol > 0) {
                        const delta = data.buy - data.sell;
                        const absDelta = Math.abs(delta);

                        // --- 1. COLUNA: SALDO (Delta) ---
                        let col1Bg = 'transparent';
                        let col1Text = '#a9b0b7';
                        let displayDelta = delta;

                        // Busca filtros personalizados para o ativo ativo
                        const activeAsset = Store.get('activeAsset');
                        const ticker = activeAsset?.ticker || '';
                        const tiers = window.Z.Filters ? window.Z.Filters.getTiersForAsset(ticker) : [150, 200, 300, 500];
                        const [t1, t2, t3, t4] = tiers;
                        const hasHighlight = absDelta >= t1;

                        if (hasHighlight) {
                            let alpha = 0.30;
                            if (absDelta >= t4) {
                                alpha = 1.00;
                            } else if (absDelta >= t3) {
                                alpha = 0.85;
                            } else if (absDelta >= t2) {
                                alpha = 0.60;
                            } else {
                                alpha = 0.30;
                            }

                            if (delta > 0) {
                                col1Bg = `rgba(37, 169, 224, ${alpha})`; // Azul
                                col1Text = '#ffffff';
                            } else if (delta < 0) {
                                col1Bg = `rgba(235, 89, 72, ${alpha})`; // Vermelho
                                col1Text = '#ffffff';
                                displayDelta = absDelta; // Oculta o sinal de menos se estiver destacado
                            }
                        } else {
                            col1Text = delta > 0 ? '#25A9E0' : (delta < 0 ? '#eb5948' : '#a9b0b7');
                        }

                        // Desenha fundo da coluna 1 (Saldo) apenas quando há Destaque (Imbalance baseado nos tiers)
                        // Feito com a mesma espessura e recuo vertical da barra da direita (levelH - 5, com offset de 2.5)
                        if (hasHighlight) {
                            _ctxMain.fillStyle = col1Bg;
                            _ctxMain.fillRect(x1 + 0.5, levelY + 2.5, col1Width - 1, levelH - 5);
                        }

                        // Ajusta dinamicamente a fonte com base no zoom para que os números caibam perfeitamente
                        const fontSize = Math.min(9, Math.max(6, Math.floor(col1Width / 3.5)));
                        _ctxMain.font = `bold ${fontSize}px "Segoe UI", Monaco, monospace`;

                        // Desenha texto do Saldo (alinhado à direita, bem próximo à caixa de Quantidade para alinhamento perfeito)
                        _ctxMain.fillStyle = col1Text;
                        _ctxMain.textAlign = 'right';
                        _ctxMain.fillText(displayDelta, x2 - 6, levelY + levelH / 2);

                        // --- 2. COLUNA: QUANTIDADE (Volume Total) ---
                        _ctxMain.fillStyle = 'rgba(30, 30, 30, 0.7)';
                        _ctxMain.fillRect(x2 + 0.5, levelY + 0.5, col2Width - 1, levelH - 1);

                        // Destaque da POC
                        if (pLevel === pocPrice) {
                            _ctxMain.strokeStyle = 'rgba(229, 110, 43, 0.9)'; // Borda Laranja
                            _ctxMain.lineWidth = 1.5;
                            _ctxMain.strokeRect(x2 + 0.5, levelY + 0.5, col2Width - 1, levelH - 1);
                            _ctxMain.fillStyle = '#ffffff';
                        } else {
                            _ctxMain.fillStyle = '#d1d4dc';
                        }

                        // Desenha texto da Quantidade
                        _ctxMain.textAlign = 'center';
                        _ctxMain.fillText(vol, x2 + col2Width / 2, levelY + levelH / 2);

                        // --- 3. COLUNA: BARRA DE VOLUME (Baseada no Saldo) ---
                        // Apenas desenha as barras de volume reativas (sem fundo escuro)
                        if (absDelta > 0) {
                            const barRatio = maxAbsDelta > 0 ? absDelta / maxAbsDelta : 0;
                            const barW = Math.max(2, (col3Width - 3) * barRatio);
                            _ctxMain.fillStyle = delta > 0 ? 'rgba(37, 169, 224, 0.85)' : 'rgba(235, 89, 72, 0.85)';
                            _ctxMain.fillRect(x3 + 1.5, levelY + 2.5, barW, levelH - 5);
                        }
                    } else {
                        // Preenche os "buracos" onde não houve negociação com o sinal "-"
                        // Fundo da coluna Quantidade (ligeiramente mais translúcido para níveis vazios)
                        _ctxMain.fillStyle = 'rgba(30, 30, 30, 0.4)';
                        _ctxMain.fillRect(x2 + 0.5, levelY + 0.5, col2Width - 1, levelH - 1);

                        // Desenha o sinal "-" centralizado
                        const fontSize = Math.min(9, Math.max(6, Math.floor(col1Width / 3.5)));
                        _ctxMain.font = `bold ${fontSize}px "Segoe UI", Monaco, monospace`;
                        _ctxMain.fillStyle = '#666666'; // Cor bem apagada
                        _ctxMain.textAlign = 'center';
                        _ctxMain.fillText("-", x2 + col2Width / 2, levelY + levelH / 2);
                    }
                }
            } else {
                // ==========================================
                // MODO PADRÃO (Zoom Normal)
                // ==========================================
                const color = isBull ? '#22e57d' : '#eb5948';
                _ctxMain.strokeStyle = color;
                _ctxMain.fillStyle = color;

                // Pavio (Wick)
                const yHigh = PriceScale.toY(c.high);
                const yLow = PriceScale.toY(c.low);
                _ctxMain.beginPath();
                _ctxMain.moveTo(x, yHigh);
                _ctxMain.lineTo(x, yLow);
                _ctxMain.stroke();

                // Corpo (Body)
                const yOpen = PriceScale.toY(c.open);
                const yClose = PriceScale.toY(c.close);
                const bodyY = Math.min(yOpen, yClose);
                const bodyH = Math.max(Math.abs(yOpen - yClose), 1); // min 1px
                _ctxMain.fillRect(x - halfW, bodyY, w, bodyH);
            }
        });
    }

    function _drawVolume(candles, maxVol, axisPriceW, axisTimeH) {
        if (!_showVolumeChart || maxVol === 0) return;

        const w = TimeScale.candleWidth;
        const halfW = w / 2;
        const chartW = _width - axisPriceW;

        candles.forEach((c, idx) => {
            const x = TimeScale.toX(idx + TimeScale.visibleStart);
            if (x > chartW) return; // Não desenha sobre o eixo

            const isBull = c.close >= c.open;

            // Cores mais transparentes para o volume
            _ctxVol.fillStyle = isBull ? 'rgba(34, 229, 125, 0.35)' : 'rgba(235, 89, 72, 0.35)';

            const h = (c.volume / maxVol) * _volHeight;
            const y = _volHeight - h;

            _ctxVol.fillRect(x - halfW, y, w, h);
        });
    }

    // ─── Linha do Preço Atual (BlackArrow "recentQuote") ─────────────────
    function _drawLastPriceLine(axisPriceW) {
        if (!_lastPrice) return;

        // Área de preço = canvas total MENOS o volume chart na base
        const priceAreaH = _height - _volHeight;
        const y = PriceScale.toY(_lastPrice);

        // Verifica se o preço está dentro da área visível (com tolerância de 1px)
        if (y < -1 || y > priceAreaH + 1) return;

        const chartW = _width - axisPriceW;
        const priceStr = Fmt.price(_lastPrice);

        // Identifica se o preço atual é alta ou baixa em relação à abertura do último candle
        const allCandles = CandleBuilder.getAll();
        const lastC = allCandles.length > 0 ? allCandles[allCandles.length - 1] : null;
        let tagColor = '#2962FF'; // azul default
        if (lastC) {
            tagColor = _lastPrice >= lastC.open ? '#22e57d' : '#eb5948'; // verde/vermelho dos candles
        }

        _ctxMain.save();
        _ctxMain.beginPath();
        _ctxMain.rect(0, 0, _width, priceAreaH); // Clip na área de preço
        _ctxMain.clip();

        // ── Linha tracejada horizontal de ponta a ponta ──
        _ctxMain.strokeStyle = tagColor;
        _ctxMain.globalAlpha = 0.6;
        _ctxMain.lineWidth = 1;
        _ctxMain.setLineDash([4, 4]);
        _ctxMain.beginPath();
        _ctxMain.moveTo(0, y);
        _ctxMain.lineTo(chartW, y);
        _ctxMain.stroke();
        _ctxMain.setLineDash([]);
        _ctxMain.globalAlpha = 1.0;

        // ── Tag de preço no eixo direito ──
        _ctxMain.font = 'bold 11px "Segoe UI", sans-serif';
        _ctxMain.textBaseline = 'middle';
        _ctxMain.textAlign = 'left';

        const textW = _ctxMain.measureText(priceStr).width;
        const BOX_PAD = 8;
        const BOX_H = 18;
        const BOX_W = textW + BOX_PAD * 2;
        const ARROW_W = 5;
        const boxX = chartW;
        const boxY = y - BOX_H / 2;

        // Fundo da tag (seta + retângulo)
        _ctxMain.fillStyle = tagColor;
        _ctxMain.beginPath();
        _ctxMain.moveTo(boxX, y);
        _ctxMain.lineTo(boxX + ARROW_W, y - ARROW_W);
        _ctxMain.lineTo(boxX + ARROW_W, boxY);
        _ctxMain.lineTo(boxX + ARROW_W + BOX_W, boxY);
        _ctxMain.lineTo(boxX + ARROW_W + BOX_W, boxY + BOX_H);
        _ctxMain.lineTo(boxX + ARROW_W, boxY + BOX_H);
        _ctxMain.lineTo(boxX + ARROW_W, y + ARROW_W);
        _ctxMain.closePath();
        _ctxMain.fill();

        // Texto do preço em branco
        _ctxMain.fillStyle = '#FFFFFF';
        _ctxMain.fillText(priceStr, boxX + ARROW_W + BOX_PAD, y);

        _ctxMain.restore();
    }

    function _drawCrosshair(axisPriceW, axisTimeH) {
        if (!_mouse.inChart || _mouseMode !== 'crosshair') {
            Dom.clear(_priceAxis); // Limpa caso o mouse saia
            return;
        }

        const x = _mouse.x;
        const y = _mouse.y;
        const chartW = _width - axisPriceW;
        // _height já exclui o time-axis — não subtrair novamente
        const chartH = _height;

        // Se o mouse estiver sobre os eixos, não desenha o crosshair no gráfico
        if (x > chartW || y > chartH) {
            Dom.clear(_priceAxis);
            return;
        }

        _ctxOver.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        _ctxOver.lineWidth = 1;
        _ctxOver.setLineDash([4, 4]); // Linha tracejada do crosshair
        _ctxOver.beginPath();

        // Linha Vertical
        _ctxOver.moveTo(x, 0);
        _ctxOver.lineTo(x, chartH);

        // Linha Horizontal
        _ctxOver.moveTo(0, y);
        _ctxOver.lineTo(chartW, y);

        _ctxOver.stroke();
        _ctxOver.setLineDash([]); // Reseta dash

        // Desenhar Label de Preço do Crosshair nativamente no Canvas Overlay
        const price = PriceScale.toPrice(y);
        const strPrice = Fmt.price(price);

        _ctxOver.font = '11px "Segoe UI", sans-serif';
        const textWidth = _ctxOver.measureText(strPrice).width;
        const boxWidth = textWidth + 16;
        const boxHeight = 22;

        // Pinta a caixa do crosshair na borda direita
        _ctxOver.fillStyle = '#d66a15'; // Laranja do cursor BlackArrow
        _ctxOver.fillRect(_width - boxWidth, y - boxHeight / 2, boxWidth, boxHeight);

        // Seta decorativa (apontador)
        _ctxOver.beginPath();
        _ctxOver.moveTo(_width - boxWidth, y - boxHeight / 2);
        _ctxOver.lineTo(_width - boxWidth - 6, y);
        _ctxOver.lineTo(_width - boxWidth, y + boxHeight / 2);
        _ctxOver.fill();

        // Texto do Preço
        _ctxOver.fillStyle = '#ffffff';
        _ctxOver.textAlign = 'right';
        _ctxOver.textBaseline = 'middle';
        _ctxOver.fillText(strPrice, _width - 8, y + 1);

        // Garantir que a DOM label antiga não exista mais
        Dom.clear(_priceAxis);
    }

    function _updateOHLV(c) {
        const openStr = c ? Fmt.price(c.open) : '---';
        const highStr = c ? Fmt.price(c.high) : '---';
        const lowStr = c ? Fmt.price(c.low) : '---';
        const closeStr = c ? Fmt.price(c.close) : '---';
        let varStr = '---';
        let colorClass = 'positive';
        if (c) {
            const diff = ((c.close - c.open) / c.open) * 100;
            varStr = (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%';
            colorClass = c.close >= c.open ? 'positive' : 'negative';
        }

        if (_chartCandleOpen) { _chartCandleOpen.textContent = openStr; _chartCandleOpen.className = colorClass; }
        if (_chartCandleHigh) { _chartCandleHigh.textContent = highStr; _chartCandleHigh.className = colorClass; }
        if (_chartCandleLow) { _chartCandleLow.textContent = lowStr; _chartCandleLow.className = colorClass; }
        if (_chartCandleClose) { _chartCandleClose.textContent = closeStr; _chartCandleClose.className = colorClass; }
        if (_chartCandleVar) { _chartCandleVar.textContent = varStr; _chartCandleVar.className = colorClass; }
    }

    function _updateFloatingToolbarVisibility(x, y, rect) {
        const toolbar = document.getElementById('zenith-floating-toolbar');
        if (!toolbar) return;
        if (toolbar.classList.contains('hidden')) return; // Respeita comando hide()

        // Zona de hover ultra responsiva e generosa:
        // y <= 120 (toda a área do topo do gráfico até a barra)
        // e centro horizontal ampliado (+- 160px do meio)
        const inHoverZone = (
            y <= 120 &&
            Math.abs(x - rect.width / 2) <= 160
        );

        if (inHoverZone) {
            toolbar.style.opacity = '1';
            toolbar.style.transform = 'translateX(-50%) translateY(0)';
            toolbar.style.pointerEvents = 'auto';
        } else {
            // Se o mouse estiver sobre o próprio toolbar, mantém ativo
            const isMouseOverToolbar = document.querySelector('#zenith-floating-toolbar:hover');
            if (isMouseOverToolbar) {
                toolbar.style.opacity = '1';
                toolbar.style.transform = 'translateX(-50%) translateY(0)';
                toolbar.style.pointerEvents = 'auto';
                return;
            }

            toolbar.style.opacity = '0';
            toolbar.style.transform = 'translateX(-50%) translateY(-10px)';
            toolbar.style.pointerEvents = 'none';
        }
    }

    // Inicializa ao carregar
    document.addEventListener('DOMContentLoaded', init);

    return {
        requestRender: _requestRender
    };
})();

window.Z.Chart = ChartEngine;
Logger.info('✅ Chart Engine carregado (chart.js)');
