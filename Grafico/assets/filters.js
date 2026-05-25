'use strict';

window.Z = window.Z || {};

window.Z.Filters = {
    // Configurações de destaque do Saldo Relevante (Delta) por ativo
    // O valor representa o limite a partir do qual o saldo é destacado.
    // Contém múltiplos tiers para determinar a opacidade (alpha) do fundo.
    // Se o ativo não estiver listado, adota os valores do 'default'.
    highlightTiers: {
        'NQM6': {
            tiers: [50, 100, 200, 300] // Nasdaq
        },
        'ESM6': {
            tiers: [150, 200, 300, 500] // S&P 500
        },
        'WINFUT': {
            tiers: [1000, 2000, 3000, 5000] // Mini Índice B3 (saldos maiores devido à liquidez nacional)
        },
        'DOLFUT': {
            tiers: [100, 150, 250, 500] // Mini Dólar B3
        },
        'default': {
            tiers: [150, 200, 300, 500] // Fallback padrão
        }
    },

    /**
     * Retorna os tiers de destaque para um determinado ativo
     * @param {string} ticker 
     * @returns {Array<number>}
     */
    getTiersForAsset(ticker) {
        if (!ticker) return this.highlightTiers['default'].tiers;
        const tk = ticker.toUpperCase();

        // Tenta correspondência exata
        if (this.highlightTiers[tk]) {
            return this.highlightTiers[tk].tiers;
        }

        // Tenta correspondência por prefixo (ex: WINQ26 -> WINFUT/WIN, DOLQ26 -> DOLFUT/DOL)
        for (const [key, config] of Object.entries(this.highlightTiers)) {
            const prefix = key.replace('FUT', '');
            if (key !== 'default' && (tk.startsWith(key) || tk.startsWith(prefix))) {
                return config.tiers;
            }
        }

        return this.highlightTiers['default'].tiers;
    }
};

window.Z.Logger?.info('✅ Filtros de Saldo Relevante carregados (filters.js)');
