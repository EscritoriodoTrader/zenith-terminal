(function () {
    // ZENITH TERMINAL - INTERLIGAÇÃO NATIVA TOTAL v4.0
    // Descoberta: owner correto é window.ks.X, Ke = window.ks.a5
    // =====================================================
    const ZENITH_BUILD = "4.0.0-DOM-OWNER";
    console.log(`%c[ZENITH] 🛡️ Escudo Ativo | Build: ${ZENITH_BUILD}`, 'color: #00d4ff; font-weight: bold;');

    // =====================================================
    // BLOCO 1: ESCUDO DE PRIVACIDADE & ReDoS
    // =====================================================
    const blacklist = ['nelogica.com.br', 'ninjatrader.com', 'activtrades.com', 'google-analytics.com'];
    const originalFetch = window.fetch;
    window.fetch = function (url, opts) {
        const urlStr = String(url);
        if (blacklist.some(domain => urlStr.includes(domain))) {
            return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
        }
        return originalFetch.apply(this, arguments);
    };

    const originalXHR = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
        this._url = String(url);
        if (blacklist.some(domain => this._url.includes(domain))) {
            this._blocked = true;
        }
        return originalXHR.apply(this, arguments);
    };

    const originalSearch = String.prototype.search;
    String.prototype.search = function (regexp) {
        const strRegex = regexp ? regexp.toString() : '';
        if (strRegex.includes('(.+)+') || strRegex.includes('(.+)*')) return -1;
        return originalSearch.apply(this, arguments);
    };

    const NativeWS = window.WebSocket;
    window.WebSocket = function (url, protocols) {
        if (url && !url.includes('127.0.0.1') && !url.includes('localhost')) {
            return new NativeWS(`ws://127.0.0.1:3000/zenith-data`, protocols);
        }
        return new NativeWS(url, protocols);
    };
    Object.assign(window.WebSocket, NativeWS);
    window.WebSocket.prototype = NativeWS.prototype;

    // =====================================================
    // BLOCO 2: DESBLOQUEIO DE PERMISSÕES PREMIUM
    // =====================================================
    const unlockPremium = (app) => {
        const Ge = app.F;
        if (Ge && !Ge._hacked) {
            Ge.licenseLoaded = true;
            Ge.nProductType = 114;
            for (let k in Ge) { if (k.startsWith('has')) Ge[k] = true; }
            Ge.bReadOnly = false;
            Ge.bLocked = false;
            Ge._hacked = true;
            console.log('%c[ZENITH] 💎 PERMISSÕES PREMIUM ATIVAS!', 'color: gold; font-weight: bold; background: black; padding: 5px;');
        }
        const Auth = app.bD;
        const Conn = app.bs;
        if (Auth) Auth.getIsLoggedIn = () => true;
        if (Conn) {
            Conn.isConnected = () => true;
            Conn.allServicesStable = () => true;
        }
    };

    // =====================================================
    // BLOCO 3: HOOK NO EVENT BUS E LUPA
    // =====================================================
    let _activeOwner = null;

    const hookEventBus = (app) => {
        const Ke = app.a5;
        if (!Ke || Ke._zenith_bus_hooked) return;

        const hasEmit = typeof Ke.emit === 'function';
        if (hasEmit) {
            const _origEmit = Ke.emit.bind(Ke);
            Ke.emit = function (eventName, ...args) {
                if (eventName === 'openTickerForm') {
                    const payload = args[0];
                    _activeOwner = payload && payload.owner;
                    console.log(`%c[ZENITH] 📣 Lupa solicitada via Event Bus!`, 'color: #00d4ff; font-weight: bold;');
                    const ws = window.zenithDataWS;
                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'REQUEST_SECURITY_LIST', prefix: '' }));
                    }
                }
                if (eventName === 'tickerSelected' || eventName === 'assetSelected' || eventName === 'selectTicker') {
                    const asset = args[0];
                    const ticker = asset && (asset.strTicker || asset.label || (typeof asset === 'string' ? asset : ''));
                    console.log(`%c[ZENITH] ✅ Ativo selecionado via Event Bus: ${ticker}`, 'color: #00ff00; font-weight: bold;');
                    const ws = window.zenithDataWS;
                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'ASSET_SELECTED', asset: ticker }));
                    }
                }
                return _origEmit(eventName, ...args);
            };
        }
        Ke._zenith_bus_hooked = true;
    };

    const hookLupa = (app) => {
        const qc = app.qc || app.m;
        if (!qc || qc._zenith_hooked) return;

        const _origRequestTickers = qc.requestTickers;
        qc.requestTickers = function (prefix) {
            const ws = window.zenithDataWS;
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'REQUEST_SECURITY_LIST', prefix: prefix || '' }));
            }
            if (_origRequestTickers) {
                try { return _origRequestTickers.call(this, prefix); } catch (e) { }
            }
        };

        const _origSelectTicker = qc.selectTicker;
        qc.selectTicker = function (asset) {
            const ticker = asset && (asset.strTicker || asset.label || asset);
            const ws = window.zenithDataWS;
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'ASSET_SELECTED', asset: ticker }));
            }
            if (_origSelectTicker) return _origSelectTicker.call(this, asset);
        };

        const _origPeriodButton = qc.onClickPeriodButton;
        qc.onClickPeriodButton = function (periodData) {
            const period = periodData && (periodData.strPeriod || periodData.label || periodData.value || JSON.stringify(periodData));
            console.log(`%c[ZENITH] ⏱️ Período selecionado: ${period}`, 'color: #ffaa00; font-weight: bold;');
            const ws = window.zenithDataWS;
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'PERIOD_SELECTED', period: periodData }));
            }
            if (_origPeriodButton) return _origPeriodButton.call(this, periodData);
        };

        const _origForceClose = qc.forceClose;
        qc.forceClose = function () {
            _activeOwner = null;
            if (_origForceClose) return _origForceClose.call(this);
        };

        qc._zenith_hooked = true;
    };

    const unlockSystem = () => {
        try {
            const app = window.ks;
            if (!app) return;
            unlockPremium(app);
            hookEventBus(app);
            hookLupa(app);
        } catch (e) {
            console.error("[ZENITH] Erro no Hook:", e);
        }
    };
    setInterval(unlockSystem, 2000);

    // =====================================================
    // BLOCO 4: INTERCEPTADOR DOM PARA LUPA NATIVA
    // =====================================================
    const triggerLupa = (eOpenType, fallbackInput = '') => {
        const app = window.ks;
        if (!app) return false;

        const owner = app.X;
        const Ke = app.a5;
        const qc = app.m || app.qc;

        if (Ke && owner) {
            console.log(`[ZENITH] 🚀 Forçando abertura via Event Bus (tipo ${eOpenType})...`);
            Ke.emit('openTickerForm', { owner: owner, eOpenType: eOpenType });
            if (fallbackInput && qc && qc.requestTickers) {
                setTimeout(() => qc.requestTickers(fallbackInput), 50);
            }
            return true;
        } else if (qc && owner && typeof qc.openForm === 'function') {
            console.log(`[ZENITH] 🚀 Forçando abertura via qc.openForm (tipo ${eOpenType})...`);
            try {
                qc.openForm(owner, eOpenType, fallbackInput, true);
                return true;
            } catch (err) {
                console.error('[ZENITH] Erro ao forçar openForm:', err);
            }
        }
        return false;
    };

    // Cliques no cabeçalho
    document.addEventListener('click', (e) => {
        // Ignora cliques que já estão dentro do overlay da lupa
        if (e.target.closest('.tickerform-overlay') || e.target.closest('.tickerform-container')) return;

        // Verifica elementos-alvo
        const isTickerClick = e.target.closest('.button-change-ticker, [class*="header-bar-outter"], .hover\\:underline');
        const isAddTabClick = e.target.closest('.asset-tabs-component__add');

        if (isTickerClick || isAddTabClick) {
            console.log(`[ZENITH] 🖱️ Clique interceptado! (Ticker: ${!!isTickerClick}, AddTab: ${!!isAddTabClick})`);
            
            // Impede o Vue/Motor de processar o clique
            e.stopPropagation();
            e.preventDefault();

            // Dispara a lupa (10 = nova aba, 0 = mudar ativo)
            triggerLupa(isAddTabClick ? 10 : 0);
        }
    }, true);

    // Digitação no Gráfico
    document.addEventListener('keydown', (e) => {
        // Ignora se estiver digitando em campo de texto
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || document.querySelector('.tickerform-overlay')) {
            return;
        }

        // Teclas simples (letras/números)
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            console.log(`[ZENITH] ⌨️ Tecla no gráfico interceptada: ${e.key}`);
            
            e.stopPropagation();
            e.preventDefault();

            triggerLupa(0, e.key);
        }
    }, true);

    // =====================================================
    // BLOCO 5: INJEÇÃO DE DADOS NA LUPA NATIVA
    // =====================================================
    const connectDataStream = () => {
        const ws = new NativeWS('ws://127.0.0.1:3000/zenith-data');
        window.zenithDataWS = ws;

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (!window.ks) return;
                const qc = window.ks.qc || window.ks.m;
                if (!qc) return;

                if (msg.type === 'ASSET_LIST_RESPONSE' && msg.assets) {
                    const formatted = msg.assets.map(a => ({
                        label:          a.asset || a.label || a.ticker,
                        desc:           a.desc || 'Ativo Zenith',
                        strTicker:      a.asset || a.label,
                        strDescription: a.desc || 'Ativo Zenith',
                        strExchange:    typeof a.exchange === 'string' ? a.exchange : 'CME',
                        nExchangeID:    typeof a.exchange === 'number' ? a.exchange : 48,
                        eAssetClass:    2,
                        bFavorite:      false
                    }));

                    qc.arrFullResults    = formatted;
                    qc.arrTickersResults = formatted;
                    qc.arrRecent         = formatted;

                    if (qc.vueInst) {
                        qc.vueInst.arrTickersResults = formatted;
                        if (typeof qc.vueInst.$forceUpdate === 'function') qc.vueInst.$forceUpdate();
                        
                        const comp = qc.vueInst.$refs && qc.vueInst.$refs.component;
                        if (comp && comp.arrTickerOptions !== undefined) {
                            comp.arrTickerOptions = formatted;
                        }
                    }
                }
            } catch (err) { }
        };

        ws.onclose = () => setTimeout(connectDataStream, 3000);
        ws.onerror = () => { };
    };
    setTimeout(connectDataStream, 2000);

    console.log('%c[ZENITH] 📡 SISTEMA PRONTO — Aguardando motor...', 'color: #00d4ff; font-weight: bold;');
})();