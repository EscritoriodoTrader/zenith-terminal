/**
 * web.dv.js — Runtime Core (equivalente ao web-DvtbTXlt.js da BlackArrow)
 * Responsabilidade: utilitários globais, EventBus, sistema de eventos
 * Sem dependências externas.
 */

'use strict';

/* ============================================================
   1. EVENT BUS — canal de comunicação entre módulos
   (mesmo padrão do EventEmitter usado internamente no BlackArrow)
   ============================================================ */
const EventBus = (() => {
    const _listeners = new Map();

    return {
        /**
         * @param {string} event
         * @param {Function} fn
         */
        on(event, fn) {
            if (!_listeners.has(event)) _listeners.set(event, new Set());
            _listeners.get(event).add(fn);
        },

        /**
         * @param {string} event
         * @param {Function} fn
         */
        off(event, fn) {
            _listeners.get(event)?.delete(fn);
        },

        /**
         * @param {string} event
         * @param {...*} args
         */
        emit(event, ...args) {
            _listeners.get(event)?.forEach(fn => {
                try { fn(...args); } catch (e) { console.error(`[EventBus] Erro em "${event}":`, e); }
            });
        },

        /** Remove todos os listeners de um evento */
        clear(event) {
            _listeners.delete(event);
        }
    };
})();

/* ============================================================
   2. STORE — estado global reativo simples
   (equivalente ao Vuex/store da BlackArrow)
   ============================================================ */
const Store = (() => {
    const _state = {
        // Ativo selecionado
        activeAsset:  null,   // { ticker, desc, exchange }
        activePeriod: '1',    // '1', '5', '15', '60', 'D'

        // Status de conexão
        connected:    false,
        pythonOnline: false,

        // Motor
        motorRunning: true,

        // Candles carregados
        candleCount:  0,
    };

    const _watchers = new Map();

    return {
        get(key) { return _state[key]; },

        set(key, value) {
            const old = _state[key];
            if (old === value) return;
            _state[key] = value;
            EventBus.emit(`store:${key}`, value, old);
            EventBus.emit('store:change', { key, value, old });
        },

        /** Observa mudança de uma chave específica */
        watch(key, fn) {
            EventBus.on(`store:${key}`, fn);
        },

        getAll() { return { ..._state }; }
    };
})();

/* ============================================================
   3. DOM HELPERS — utilitários de DOM leves
   ============================================================ */
const Dom = {
    /** @param {string} selector @param {Element} [ctx] */
    $: (selector, ctx = document) => ctx.querySelector(selector),

    /** @param {string} selector @param {Element} [ctx] */
    $$: (selector, ctx = document) => [...ctx.querySelectorAll(selector)],

    /**
     * Cria elemento com atributos e filhos
     * @param {string} tag
     * @param {Object} attrs
     * @param {...(string|Element)} children
     */
    el(tag, attrs = {}, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class')   el.className = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
            else el.setAttribute(k, v);
        }
        children.forEach(c => {
            if (typeof c === 'string') el.appendChild(document.createTextNode(c));
            else if (c instanceof Element) el.appendChild(c);
        });
        return el;
    },

    clear(el) {
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
    },

    /** Adiciona/remove classe com base em condição */
    toggle(el, cls, condition) {
        el.classList.toggle(cls, condition);
    }
};

/* ============================================================
   4. FORMATTERS — formatação de números e datas
   (mesmo padrão de formatação usado no BlackArrow)
   ============================================================ */
const Fmt = {
    /**
     * Retorna a quantidade de casas decimais com base no tick size
     * @param {number} tickSize
     * @returns {number}
     */
    getDecimals(tickSize) {
        if (tickSize === undefined || tickSize === null) return 2;
        if (Number.isInteger(tickSize)) return 0;
        const str = tickSize.toString();
        const eIndex = str.indexOf('e');
        if (eIndex !== -1) {
            const exp = parseInt(str.substring(eIndex + 1));
            if (exp < 0) return -exp;
        }
        const dotIndex = str.indexOf('.');
        if (dotIndex !== -1) {
            return str.length - dotIndex - 1;
        }
        return 0;
    },

    /**
     * Formata preço com casas decimais corretas por ativo
     * @param {number} n
     * @param {number} [decimals]
     */
    price(n, decimals) {
        if (!n && n !== 0) return '---';
        const num = typeof n === 'number' ? n : parseFloat(n);
        if (isNaN(num)) return '---';

        let dec = decimals;
        if (dec === undefined) {
            // Determina dinamicamente com base no ativo ativo
            const activeAsset = window.Z?.Store?.get('activeAsset');
            const ticker = activeAsset ? (String(activeAsset.ticker || activeAsset)) : null;
            if (ticker) {
                const tk = ticker.toUpperCase();
                if (tk.startsWith('WIN') || tk.startsWith('IND')) {
                    dec = 0;
                } else if (tk.startsWith('WDO') || tk.startsWith('DOL')) {
                    dec = 1;
                } else if (tk.startsWith('NQ') || tk.startsWith('ES') || tk.startsWith('MNQ') || tk.startsWith('MES') || tk.startsWith('RTY') || tk.startsWith('MRY')) {
                    dec = 2;
                } else if (tk.startsWith('EUR') || tk.startsWith('GBP')) {
                    dec = 5;
                } else if (tk.startsWith('JPY')) {
                    dec = 7;
                } else if (tk.startsWith('BTC')) {
                    dec = 0;
                } else {
                    // Fallback para precisão decimal do tickSize
                    const tickSize = window.Z?.PriceScale?.tickSize;
                    if (tickSize) {
                        dec = this.getDecimals(tickSize);
                    } else {
                        dec = 2;
                    }
                }
            } else {
                dec = 2;
            }
        }

        return num.toLocaleString('pt-BR', {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec
        });
    },

    /**
     * Formata volume (ex: 1500 → "1,5K")
     * @param {number} n
     */
    volume(n) {
        if (!n && n !== 0) return '---';
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
        return String(n);
    },

    /**
     * Formata variação percentual
     * @param {number} n
     */
    variation(n) {
        if (n === undefined || n === null) return '---';
        const sign = n >= 0 ? '+' : '';
        return `${sign}${n.toFixed(2)}%`;
    },

    /**
     * Timestamp ms → "HH:MM:SS"
     * @param {number} ts
     */
    time(ts) {
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    },

    /**
     * Timestamp ms → "DD/MM HH:MM"
     * @param {number} ts
     */
    datetime(ts) {
        const d = new Date(ts);
        const dd = String(d.getDate()).padStart(2, '0');
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mo} ${this.time(ts).slice(0, 5)}`;
    }
};

/* ============================================================
   5. LOGGER — log estruturado (substitui console puro)
   ============================================================ */
const Logger = {
    _prefix: '[ZENITH]',

    info  (...a) { console.log   (`%c${this._prefix}`, 'color:#00d4ff;font-weight:bold', ...a); },
    warn  (...a) { console.warn  (`%c${this._prefix}`, 'color:#fbc120;font-weight:bold', ...a); },
    error (...a) { console.error (`%c${this._prefix}`, 'color:#eb5948;font-weight:bold', ...a); },
    debug (...a) { console.debug (`%c${this._prefix}`, 'color:#9f9f9f', ...a); },
};

/* ============================================================
   EXPORTA GLOBALMENTE (sem bundler, acesso direto)
   ============================================================ */
window.Z = window.Z || {};
Object.assign(window.Z, { EventBus, Store, Dom, Fmt, Logger });

Logger.info('✅ Runtime Core carregado (web.dv.js)');
