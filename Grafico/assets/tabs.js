/**
 * tabs.js — Sistema Dinâmico de Abas do Titlebar
 * Responsabilidade: Gerenciar criação, remoção e ativação de abas de ativos.
 * Sincroniza com Store.activeAsset e Store.activePeriod.
 */

'use strict';

const TabManager = (() => {
    const { Dom, EventBus, Store, Logger } = window.Z;

    // Estado interno das abas
    let _tabs = [];   // [{ ticker, period, var, exch }]
    let _activeIdx = 0;

    // Referência ao container das abas no DOM
    let _container;  // .asset-tabs-component.slider (interno)
    let _addBtn;     // .asset-tabs-component__add

    // SVG do ícone de ativo (simplificado — sem gradiente pesado)
    const ASSET_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="14" height="14" x="1" y="1" rx="3" fill="#2a2a2a" stroke="#555" stroke-width="0.5"/>
        <path d="M4.5 5.5h3l2 5h-3z" fill="#ccc"/>
    </svg>`;

    // SVG do ícone fechar
    const CLOSE_ICON_SVG = `<svg width="8" height="8" xmlns="http://www.w3.org/2000/svg">
        <path transform="scale(0.8,0.8)" stroke="null" fill="#dcdcdc"
            d="m9.898617,1.010074l-1.002234,-1.010074l-3.947074,3.977948l-3.947073,-3.977948l-1.002235,1.010074l3.947074,3.977949l-3.947074,3.977948l1.002235,1.010074l3.947073,-3.977948l3.947074,3.977948l1.002234,-1.010074l-3.947073,-3.977948l3.947073,-3.977949z">
        </path>
    </svg>`;

    function init() {
        // Encontra o container interno das abas (o segundo .asset-tabs-component.slider)
        const allSliders = Dom.$$('.asset-tabs-component.slider');
        _container = allSliders[allSliders.length - 1]; // o mais interno
        _addBtn = Dom.$('.asset-tabs-component__add');

        if (!_container) {
            Logger.warn('TabManager: container de abas não encontrado');
            return;
        }

        // Lê abas existentes no HTML e constrói estado inicial
        _initFromDOM();

        // Bindings
        _addBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            window.Z.Lupa?.open();
        });

        // Escuta mudanças de ativo (vindo da lupa ou externamente)
        Store.watch('activeAsset', (asset) => {
            if (!asset) return;
            const existing = _tabs.findIndex(t => t.ticker === asset.ticker);
            if (existing >= 0) {
                // Ativa a aba existente
                _setActive(existing);
            } else {
                // Adiciona nova aba
                _addTab(asset.ticker, asset.exch || 'CME');
            }
            _renderTabs();
        });

        // Escuta mudanças de período — atualiza período em todas as abas visíveis
        Store.watch('activePeriod', (period) => {
            if (_tabs[_activeIdx]) {
                _tabs[_activeIdx].period = period;
                _saveTabs();
                _renderTabs();
            }
        });

        // Escuta variação de preço (ws:newData)
        EventBus.on('ws:newData', ({ asset, variation }) => {
            if (!asset || variation === undefined) return;
            
            const clean = (name) => {
                let n = String(name).toUpperCase().replace(/_M_\d+$/, '').trim();
                if (n.startsWith('WIN') || n.startsWith('IND')) return 'WIN';
                if (n.startsWith('DOL') || n.startsWith('WDO')) return 'DOL';
                if (n.startsWith('NQ')) return 'NQ';
                if (n.startsWith('ES')) return 'ES';
                return n;
            };

            const normAsset = clean(asset);
            _tabs.forEach((tab, idx) => {
                const normTab = clean(tab.ticker);
                if (normTab === normAsset) {
                    if (tab.var !== variation) {
                        tab.var = variation;
                        _updateTabVariationDOM(idx);
                    }
                }
            });
        });

        Logger.info('✅ TabManager inicializado');
    }

    function _updateTabVariationDOM(idx) {
        if (!_container) return;
        const existingTabEls = _container.querySelectorAll('.asset-tabs-component__tab');
        if (existingTabEls[idx]) {
            const tab = _tabs[idx];
            const varClass = tab.var > 0 ? 'positive' : tab.var < 0 ? 'negative' : '';
            const varText = tab.var ? (tab.var > 0 ? '+' : '') + tab.var.toFixed(2).replace('.', ',') + '%' : '';
            
            let varSpan = existingTabEls[idx].querySelector('.asset-tabs-component__variation');
            if (varText) {
                if (varSpan) {
                    varSpan.textContent = varText;
                    varSpan.className = `pointer-events-none asset-tabs-component__variation ${varClass}`;
                } else {
                    varSpan = document.createElement('span');
                    varSpan.className = `pointer-events-none asset-tabs-component__variation ${varClass}`;
                    varSpan.textContent = varText;
                    const closeIcon = existingTabEls[idx].querySelector('.close-icon');
                    if (closeIcon) {
                        existingTabEls[idx].insertBefore(varSpan, closeIcon);
                    } else {
                        existingTabEls[idx].appendChild(varSpan);
                    }
                }
            } else if (varSpan) {
                varSpan.remove();
            }
        }
    }


    function _saveTabs() {
        // Limpa as variações ao salvar para que ao atualizar a tela fique 'zerado' até o python enviar
        const cleanTabs = _tabs.map(t => ({ ...t, var: 0 }));
        localStorage.setItem('zenith_tabs', JSON.stringify(cleanTabs));
        localStorage.setItem('zenith_active_tab', _activeIdx);
    }

    function _initFromDOM() {
        // Ignoramos completamente os 3 ativos 'hardcoded' no HTML original
        const savedTabs = JSON.parse(localStorage.getItem('zenith_tabs') || '[]');
        if (savedTabs.length > 0) {
            _tabs = savedTabs;
            _activeIdx = parseInt(localStorage.getItem('zenith_active_tab') || '0', 10);
            if (_activeIdx >= _tabs.length) _activeIdx = 0;
        } else {
            // Se for o primeiro acesso, cria 1 única aba baseada no ativo atual
            const asset = Store.get('activeAsset');
            const period = Store.get('activePeriod') || '1Min';
            _tabs.push({ ticker: asset?.ticker || 'NQFUT', period: period, var: 0, exch: asset?.exch || 'CME' });
            _activeIdx = 0;
        }

        // Garante que o Store inicie sincronizado com a aba ativa recuperada
        const tab = _tabs[_activeIdx];
        Store.set('activeAsset', { ticker: tab.ticker, exch: tab.exch });
        Store.set('activePeriod', tab.period);
        
        // Carrega o histórico inicial salvo no Supabase para esta aba ativa
        window.Z.DataBridge?.loadHistoryFromDb(tab.ticker);

        _renderTabs();
    }

    function _addTab(ticker, exch = 'CME') {
        _tabs.push({ ticker, period: Store.get('activePeriod') || '1Min', var: 0, exch });
        _activeIdx = _tabs.length - 1;
        _saveTabs();
        
        window.Z.DataBridge?.changeAsset('T&T0', ticker);
        window.Z.DataBridge?.loadHistoryFromDb(ticker);
    }

    function _setActive(idx) {
        if (idx < 0 || idx >= _tabs.length) return;
        _activeIdx = idx;
        _saveTabs();
        
        // Troca o ativo no Store primeiro para que os watchers síncronos rodem antes de carregar o histórico
        const tab = _tabs[idx];
        const currentAsset = Store.get('activeAsset');
        if (!currentAsset || currentAsset.ticker !== tab.ticker) {
            Store.set('activeAsset', { ticker: tab.ticker, exch: tab.exch });
        }

        window.Z.DataBridge?.changeAsset('T&T0', tab.ticker);
        window.Z.DataBridge?.loadHistoryFromDb(tab.ticker);
    }

    function _closeTab(idx, e) {
        e.stopPropagation();
        if (_tabs.length <= 1) return; // Não fecha a última aba
        _tabs.splice(idx, 1);
        if (_activeIdx >= _tabs.length) _activeIdx = _tabs.length - 1;
        
        _saveTabs();
        
        // Troca para ativo da nova aba ativa
        const tab = _tabs[_activeIdx];
        Store.set('activeAsset', { ticker: tab.ticker, exch: tab.exch });
        window.Z.DataBridge?.changeAsset('T&T0', tab.ticker);
        window.Z.DataBridge?.loadHistoryFromDb(tab.ticker);
        _renderTabs();
    }

    function _renderTabs() {
        if (!_container) return;
        // Limpa apenas as abas (não o botão +)
        const existingTabEls = _container.querySelectorAll('.asset-tabs-component__tab');
        existingTabEls.forEach(el => el.remove());

        // Recria as abas dinamicamente
        _tabs.forEach((tab, idx) => {
            const isActive = idx === _activeIdx;
            const varClass = tab.var > 0 ? 'positive' : tab.var < 0 ? 'negative' : '';
            const varText = tab.var ? (tab.var > 0 ? '+' : '') + tab.var.toFixed(2).replace('.', ',') + '%' : '';
            const showClose = _tabs.length > 1;

            const tabEl = document.createElement('div');
            tabEl.setAttribute('data-v-2a79461c', '');
            tabEl.setAttribute('str-asset-key-entity', `${tab.ticker}|77|1|1|1`);
            tabEl.setAttribute('data-draggable', 'true');
            tabEl.setAttribute('draggable', 'false');
            tabEl.className = `asset-tabs-component__tab asset-tab${isActive ? ' asset-tabs-component__tab--active' : ''}`;

            tabEl.innerHTML = `
                <div data-v-2a79461c="" class="image-ticker-container">
                    <div data-v-2a79461c="" style="width:14px;height:14px;flex-shrink:0">${ASSET_ICON_SVG}</div>
                    <span data-v-2a79461c="" class="title-ticker">${tab.ticker}</span>
                    <span data-v-2a79461c="" class="title-period">${tab.period}</span>
                </div>
                ${varText ? `<span class="pointer-events-none asset-tabs-component__variation ${varClass}">${varText}</span>` : '<!---->'}
                ${showClose ? `<span class="close-icon">${CLOSE_ICON_SVG}</span>` : '<!---->'}
            `;

            // Clique na aba = ativa ativo
            tabEl.addEventListener('click', (e) => {
                if (e.target.closest('.close-icon')) return;
                _setActive(idx);
                _renderTabs();
            });

            // Clique no X = fecha aba
            const closeEl = tabEl.querySelector('.close-icon');
            closeEl?.addEventListener('click', (e) => _closeTab(idx, e));

            // Insere ANTES do botão +
            _container.insertBefore(tabEl, _addBtn);
        });
    }

    // Método público: atualiza variação da aba ativa
    function updateActiveVariation(variation) {
        if (_tabs[_activeIdx]) {
            _tabs[_activeIdx].var = variation;
            _renderTabs();
        }
    }

    // Método público: atualiza período da aba ativa
    function updateActivePeriod(period) {
        if (_tabs[_activeIdx]) {
            _tabs[_activeIdx].period = period;
            _renderTabs();
        }
    }

    document.addEventListener('DOMContentLoaded', init);

    return { updateActiveVariation, updateActivePeriod };
})();

window.Z.TabManager = TabManager;
