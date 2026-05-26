/**
 * modal.js — Lupa de Ativos (Busca) - Clone estrutural da BlackArrow
 * Responsabilidade: UI do modal de busca usando estrutura HTML exata.
 * Suporta filtros por categoria: Todas, Forex, Commodities, Ações, Futuros, Opções, Período, Indicadores, Recentes
 */

'use strict';

const LupaModal = (() => {
    const { Dom, EventBus, Store, Logger, Fmt } = window.Z;
    let _overlay;
    let _input, _list, _closeBtn;

    let _isOpen = false;
    let _assets = [];
    let _activeFilter = 'Todas';
    let _recentes = []; // histórico de ativos recentes (últimos 5)

    const PERIOD_ITEMS = [
        { ticker: '1', desc: '1 Minuto', exch: 'GRAF', type: 'Período' },
        { ticker: '2', desc: '2 Minutos', exch: 'GRAF', type: 'Período' },
        { ticker: '3', desc: '3 Minutos', exch: 'GRAF', type: 'Período' },
        { ticker: '5', desc: '5 Minutos', exch: 'GRAF', type: 'Período' },
        { ticker: '10', desc: '10 Minutos', exch: 'GRAF', type: 'Período' },
        { ticker: '15', desc: '15 Minutos', exch: 'GRAF', type: 'Período' },
        { ticker: '30', desc: '30 Minutos', exch: 'GRAF', type: 'Período' },
        { ticker: '60', desc: '60 Minutos', exch: 'GRAF', type: 'Período' },
        { ticker: 'D', desc: 'Gráfico Diário', exch: 'GRAF', type: 'Período' },
        
        { ticker: '1P', desc: '1 Ponto (1 Tick)', exch: 'GRAF', type: 'Período' },
        { ticker: '2P', desc: '2 Pontos (2 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '3P', desc: '3 Pontos (3 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '4P', desc: '4 Pontos (4 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '5P', desc: '5 Pontos (5 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '6P', desc: '6 Pontos (6 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '10P', desc: '10 Pontos (10 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '15P', desc: '15 Pontos (15 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '20P', desc: '20 Pontos (20 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '30P', desc: '30 Pontos (30 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '50P', desc: '50 Pontos (50 Ticks)', exch: 'GRAF', type: 'Período' },
        { ticker: '100P', desc: '100 Pontos (100 Ticks)', exch: 'GRAF', type: 'Período' }
    ];

    // A lista de ativos agora é carregada dinamicamente do servidor (server.js)

    function init() {
        _overlay = Dom.$('#modal-search');
        if (!_overlay) return;

        // Estrutura HTML Idêntica à capturada da BlackArrow
        _overlay.innerHTML = `
            <div class="tickerform-component expanded">
                <div class="tickerform-component-header">
                    <div class="tickerform-component-header-titlebar">
                        <span class="tickerform-component-header-titlebar-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <path d="M18.364 5.63608C19.6227 6.89476 20.4798 8.4984 20.8271 10.2442C21.1743 11.9901 20.9961 13.7996 20.3149 15.4442C19.6337 17.0887 18.4802 18.4943 17.0001 19.4832C15.5201 20.4722 13.78 21 12 21C10.22 21 8.47992 20.4722 6.99988 19.4832C5.51984 18.4943 4.36629 17.0887 3.6851 15.4442C3.00391 13.7996 2.82567 11.9901 3.17293 10.2442C3.52019 8.4984 4.37734 6.89476 5.636 5.63608C6.47173 4.80034 7.46389 4.13739 8.55583 3.68509C9.64776 3.2328 10.8181 3 12 3C13.1819 3 14.3522 3.2328 15.4442 3.68509C16.5361 4.13739 17.5283 4.80034 18.364 5.63608" stroke="#22e57d" stroke-width="1.5" stroke-linecap="round"></path>
                                <path d="M15.891 12.391H11.5V7" stroke="#fff" stroke-width="1.5" stroke-linecap="round"></path>
                            </svg>
                        </span>
                        <span class="tickerform-component-header-titlebar-title">Busque Ativos, Períodos ou Indicadores - Gráfico</span>
                        <span class="tickerform-component-header-titlebar-close-btn" id="modal-close-btn">
                            <svg width="12" height="12"><path fill="#dcdcdc" d="m9.898617,1.010074l-1.002234,-1.010074l-3.947074,3.977948l-3.947073,-3.977948l-1.002235,1.010074l3.947074,3.977949l-3.947074,3.977948l1.002235,1.010074l3.947073,-3.977948l3.947074,3.977948l1.002234,-1.010074l-3.947073,-3.977948l3.947073,-3.977949z"></path></svg>
                        </span>
                    </div>
                    
                    <div class="tickerform-component-header-searchbar">
                        <div class="tickerform-component-header-searchbar-icon">
                            <svg viewBox="0 0 83.75 83.71" width="12" height="12"><path fill="#d6d6d6" d="M83.67,74.52l-24-23.85a32,32,0,0,0,5.68-18.23,32.66,32.66,0,1,0-15,27.17l24.17,24ZM13.39,32.61A19.51,19.51,0,1,1,32.9,52,19.44,19.44,0,0,1,13.39,32.61Z"></path></svg>
                        </div>
                        <div class="tickerform-component-header-searchbar-input-text">
                            <input id="modal-input" class="tickerform-component-header-searchbar-input" type="text" placeholder="Busque Ativos, Períodos ou Indicadores" autocomplete="off">
                        </div>
                        <div class="select-multiple__wrapper">
                            <span>Todas Bolsas</span>
                            <div style="margin-left: auto;"><svg width="11" height="7" viewBox="0 0 11 7" fill="none"><path d="M1.50144 1.00145L5.49999 5L9.49854 1" stroke="currentColor" stroke-width="1.5"></path></svg></div>
                        </div>
                    </div>

                    <div class="tickerform-component-header-buttons" id="modal-filter-btns">
                        <button class="tickerform-component-header-buttons--filter selected" data-filter="Todas">Todas</button>
                        <button class="tickerform-component-header-buttons--filter" data-filter="Forex">Forex</button>
                        <button class="tickerform-component-header-buttons--filter" data-filter="Commodities">Commodities</button>
                        <button class="tickerform-component-header-buttons--filter" data-filter="Ações">Ações</button>
                        <button class="tickerform-component-header-buttons--filter" data-filter="Futuros">Futuros</button>
                        <button class="tickerform-component-header-buttons--filter" data-filter="Opções">Opções</button>
                        <button class="tickerform-component-header-buttons--filter" data-filter="Período">Período</button>
                        <button class="tickerform-component-header-buttons--filter" data-filter="Indicadores">Indicadores</button>
                        <button class="tickerform-component-header-buttons--filter" data-filter="Recentes">Recentes</button>
                    </div>

                    <div class="tickerform-component-header-column-names">
                        <span>Símbolo</span><span>Descrição</span><span>Bolsa</span><span style="text-align: right;">Último</span><span style="text-align: right;">Variação</span>
                    </div>
                </div>

                <ul class="tickerform-component-results" id="modal-list"></ul>
            </div>
        `;

        _input    = Dom.$('#modal-input');
        _list     = Dom.$('#modal-list');
        _closeBtn = Dom.$('#modal-close-btn');

        // Inicia vazio, será populado via ws:assetList assim que abrir a lupa
        _assets = [];

        _bindEvents();
    }

    function _bindEvents() {
        Dom.$('#btn-search')?.addEventListener('click', open);
        Dom.$('#btn-search-indicator')?.addEventListener('click', open);

        _overlay.addEventListener('mousedown', (e) => {
            if (e.target === _overlay) close();
        });

        _closeBtn.addEventListener('click', close);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && _isOpen) close();
            if (!_isOpen && e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault(); // Impede que o navegador digite a tecla de novo no input focado
                open();
                _input.value = e.key;
                _renderList(_input.value);
            }
        });

        _input.addEventListener('input', () => _renderList(_input.value));

        _input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const firstRow = Dom.$('.tickerform-component-results-ticker', _list);
                if (firstRow) firstRow.click();
                else if (_input.value.trim().length >= 2) _selectAsset(_input.value.trim().toUpperCase());
            }
        });

        // Filtros de categoria
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.tickerform-component-header-buttons--filter');
            if (!btn) return;
            _activeFilter = btn.dataset.filter || 'Todas';
            document.querySelectorAll('.tickerform-component-header-buttons--filter').forEach(b => {
                b.classList.toggle('selected', b.dataset.filter === _activeFilter);
            });
            _renderList(_input?.value || '');
        });

        EventBus.on('ws:assetList', (assets) => {
            const mapped = assets.map(a => {
                const ticker = typeof a === 'string' ? a : (a.label || a.asset);
                return {
                    ticker: ticker,
                    desc: a.desc || 'Ativo',
                    exch: a.exchange || a.bolsa || 'CME',
                    type: a.type || 'Todas',
                    price: a.price || 0,
                    var: a.var || 0
                };
            });
            // Atualiza a lista existente com os dados em tempo real
            mapped.forEach(newA => {
                const existingIndex = _assets.findIndex(a => a.ticker === newA.ticker);
                if (existingIndex !== -1) {
                    // Atualiza o existente e move para o topo se tiver dados reais
                    _assets[existingIndex].price = newA.price;
                    _assets[existingIndex].var = newA.var;
                    if (newA.price > 0) {
                        const item = _assets.splice(existingIndex, 1)[0];
                        _assets.unshift(item);
                    }
                } else {
                    _assets.unshift(newA);
                }
            });
            if (_isOpen) _renderList(_input?.value || '');
        });
    }

    function open() {
        if (_isOpen) return;
        _isOpen = true;
        Dom.toggle(_overlay, 'hidden', false);
        _input.value = '';
        _activeFilter = 'Todas';
        // Reset botões de filtro
        document.querySelectorAll('.tickerform-component-header-buttons--filter').forEach(b => {
            b.classList.toggle('selected', b.dataset.filter === 'Todas');
        });
        _input.focus();
        window.Z.DataBridge?.requestAssetList();
        _renderList();
    }

    function close() {
        if (!_isOpen) return;
        _isOpen = false;
        Dom.toggle(_overlay, 'hidden', true);
        _input.blur();
    }

    function _selectAsset(ticker) {
        // Se for um período em minutos (ex: '1', '2', '3', '5', '10', '15', '30', '60', 'D', '1D')
        if (['1', '2', '3', '5', '10', '15', '30', '60', 'D', '1D'].includes(ticker)) {
            const cleanTicker = ticker === '1D' ? 'D' : ticker;
            const period = cleanTicker === 'D' ? 'Diário' : cleanTicker + 'Min';
            
            // Define o período no construtor de velas e no Store global
            window.Z.CandleBuilder?.setPeriod(cleanTicker);
            Store.set('activePeriod', period);
            close();
            return;
        }

        // Se for um período em pontos (ex: '5P', '10P', '20P')
        const pointsMatch = ticker.match(/^(\d+)P$/i);
        if (pointsMatch) {
            const cleanTicker = pointsMatch[1].toUpperCase() + 'P';
            const period = cleanTicker;
            
            // Define o período no construtor de velas e no Store global
            window.Z.CandleBuilder?.setPeriod(cleanTicker);
            Store.set('activePeriod', period);
            close();
            return;
        }

        const info = _assets.find(a => a.ticker === ticker)
            || { ticker, desc: 'Ativo', exch: 'CME', type: 'Todas' };

        // Adiciona a recentes
        _recentes = _recentes.filter(t => t !== ticker);
        _recentes.unshift(ticker);
        if (_recentes.length > 8) _recentes.pop();

        // Marca flag no TabManager ANTES de setar o Store para que o watcher do tabs.js
        // saiba que a modal já está tratando o changeAsset — evita mensagem duplicada.
        if (window.Z.TabManager?._setChangingAsset) {
            window.Z.TabManager._setChangingAsset(true);
        }
        Store.set('activeAsset', info);
        if (window.Z.TabManager?._setChangingAsset) {
            window.Z.TabManager._setChangingAsset(false);
        }

        // A modal é a responsável pelo único changeAsset correto
        window.Z.DataBridge?.changeAsset('T&T0', ticker);
        if (ticker === 'HISTORICO') window.Z.DataBridge?.reloadHistory();
        else window.Z.DataBridge?.clearChart();
        close();
    }

    function _renderList(query = '') {
        Dom.clear(_list);
        const q = query.toLowerCase().trim();

        // Filtra por categoria
        let filtered = [];

        if (_activeFilter === 'Todas') {
            filtered = [..._assets, ...PERIOD_ITEMS];
        } else if (_activeFilter === 'Período') {
            filtered = PERIOD_ITEMS;
        } else if (_activeFilter === 'Recentes') {
            filtered = _recentes.map(t => _assets.find(a => a.ticker === t) || PERIOD_ITEMS.find(p => p.ticker === t)).filter(Boolean);
        } else if (_activeFilter !== 'Todas' && _activeFilter !== 'Indicadores') {
            filtered = _assets.filter(a => a.type === _activeFilter);
        } else if (_activeFilter === 'Indicadores') {
            // Sem indicadores por enquanto — mostra vazio
            filtered = [];
        }

        // Filtra por texto de busca
        if (q) {
            filtered = filtered.filter(a =>
                a.ticker.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            const emptyEl = Dom.el('li', { style: 'padding: 12px 16px; color: var(--grey-99); font-size: 12px;' });
            emptyEl.textContent = q ? `Nenhum ativo encontrado para "${q}"` : 'Nenhum ativo disponível nesta categoria.';
            _list.appendChild(emptyEl);
            return;
        }

        filtered.forEach(asset => {
            const row = Dom.el('li', { class: 'tickerform-component-results-ticker' });
            
            const highlight = (text) => {
                if (!q) return text;
                const idx = text.toLowerCase().indexOf(q);
                if (idx === -1) return text;
                return text.substring(0, idx) + `<span class="text-accent">` + text.substring(idx, idx + q.length) + `</span>` + text.substring(idx + q.length);
            };

            const varColor = asset.var > 0 ? 'text-buy' : asset.var < 0 ? 'text-sell' : 'text-muted';
            const priceFmt = asset.price ? Fmt.price(asset.price) : '---';
            const varFmt   = asset.var ? (asset.var > 0 ? '+' : '') + asset.var.toFixed(2) + '%' : '---';

            // Badge de tipo (A para Ativo, Relógio para Período)
            let typeTag = '';
            if (asset.type === 'Período') {
                const isPoints = String(asset.ticker).endsWith('P');
                const imgSrc = isPoints ? 'images/dark_point.png' : 'images/dark_minute.png';
                typeTag = `<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;background:rgba(255,255,255,0.07);border-radius:2px;margin-right:4px;">
                    <img src="${imgSrc}" style="width:10px;height:10px;display:block;" />
                </span>`;
            } else {
                // Ícone de Ativo
                typeTag = `<span style="font-size:9px;background:rgba(255,255,255,0.07);border-radius:2px;padding:1px 3px;margin-right:4px;color:var(--grey-99)">A</span>`;
            }

            row.innerHTML = `
                <div class="tickerform-component-results-ticker__name">
                    ${typeTag} ${highlight(asset.ticker)}
                </div>
                <div class="tickerform-component-results-ticker__description">${highlight(asset.desc)}</div>
                <div class="tickerform-component-results-ticker__exchange">${asset.exch}</div>
                <div class="tickerform-component-results-ticker__close">${priceFmt}</div>
                <div class="tickerform-component-results-ticker__variation ${varColor}">${varFmt}</div>
            `;
            row.addEventListener('click', () => _selectAsset(asset.ticker));
            _list.appendChild(row);
        });
    }

    document.addEventListener('DOMContentLoaded', init);
    return { open, close };
})();

window.Z.Lupa = LupaModal;
