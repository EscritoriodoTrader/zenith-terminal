/**
 * ZENITH TERMINAL - V8.7
 * MOTOR HÍBRIDO - TEMPO E PONTOS (P)
 */

// 1. CONFIGURAÇÃO E ELEMENTOS
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
const scaleCanvas = document.getElementById('price-scale');
const scaleCtx = scaleCanvas.getContext('2d');
const timeCanvas = document.getElementById('time-scale');
const timeCtx = timeCanvas.getContext('2d');
const candleTooltip = document.getElementById('candle-tooltip');
const settingsOverlay = document.getElementById('settings-overlay');
const searchOverlay = document.getElementById('search-overlay');
const searchInput = document.getElementById('search-input');
const filterContainer = document.getElementById('filter-container');

// 2. ESTADO GLOBAL (STORAGE SEGURO)
function getStorage(key, fallback) {
    try { return localStorage.getItem(key) || fallback; }
    catch (e) { return fallback; }
}
function setStorage(key, val) {
    try { localStorage.setItem(key, val); }
    catch (e) { console.warn("Storage bloqueado por segurança do navegador (CORS/File)"); }
}

function showCustomConfirm(message, onConfirm) {
    const modal = document.getElementById('custom-confirm-modal');
    const textEl = document.getElementById('custom-confirm-text');
    const btnYes = document.getElementById('custom-confirm-yes');
    const btnNo = document.getElementById('custom-confirm-no');
    
    if (!modal || !textEl || !btnYes || !btnNo) {
        if (confirm(message)) onConfirm();
        return;
    }
    
    textEl.innerText = message;
    modal.style.display = 'flex';
    
    const cleanup = () => {
        modal.style.display = 'none';
        btnYes.onclick = null;
        btnNo.onclick = null;
    };
    
    btnYes.onclick = () => { cleanup(); onConfirm(); };
    btnNo.onclick = () => { cleanup(); };
}

let chartBgColor = getStorage('zenith_bg_color', '#131722');
let themeColor = getStorage('zenith_theme_color', '#1c2027');
let scaleFontSize = parseInt(getStorage('zenith_font_size', '12'));
let scaleFontColor = getStorage('zenith_font_color', '#787b86');

let posColor = getStorage('zenith_pos_color', '#089981');
let negColor = getStorage('zenith_neg_color', '#f23645');
let posOutlineColor = getStorage('zenith_pos_outline', '#089981');
let negOutlineColor = getStorage('zenith_neg_outline', '#f23645');
let lastPriceBgColor = getStorage('zenith_last_price_bg', '#ff9800');
let lastPriceLineColor = getStorage('zenith_last_price_line', '#ff9800');
let footprintBgColor = getStorage('zenith_footprint_bg', '#1e222d');

let footprintFontColor = getStorage('zenith_footprint_font', '#ffffff');



let filters = [];
try {
    filters = JSON.parse(localStorage.getItem('zenith_filters')) || [{ balance: 100, color: '#ffd700', opacity: 80 }];
} catch (e) {
    filters = [{ balance: 100, color: '#ffd700', opacity: 80 }];
}

let rawTrades = [];
let processedTradeIds = new Set();
let tempSettings = {};
let verticalZoom = 24; // Altura fixa de cada tick (0.25) em pixels
let motorStatus = getStorage('zenith_motor', 'off');
let socket;
let isMountingHistory = false;



const priceFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
document.documentElement.style.setProperty('--theme-bg', themeColor);

function hexToRgba(hex, opacity) {
    if (!hex || hex.length < 7) return `rgba(255, 255, 255, ${opacity / 100})`;
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

function isModalOpen() {
    return (settingsOverlay && settingsOverlay.classList.contains('active')) || (searchOverlay && searchOverlay.classList.contains('active'));
}

// 2.1 PERSISTÊNCIA NO SERVIDOR (Sincronização com o Sistema)
async function loadSettingsFromServer() {
    try {
        const resp = await fetch('/api/settings?t=' + Date.now(), { cache: 'no-store' });
        const cfg = await resp.json();
        if (Object.keys(cfg).length > 0) {
            if (cfg.chartBgColor) { chartBgColor = cfg.chartBgColor; setStorage('zenith_bg_color', chartBgColor); }
            if (cfg.themeColor) { themeColor = cfg.themeColor; setStorage('zenith_theme_color', themeColor); }
            if (cfg.posColor) { posColor = cfg.posColor; setStorage('zenith_pos_color', posColor); }
            if (cfg.negColor) { negColor = cfg.negColor; setStorage('zenith_neg_color', negColor); }
            if (cfg.currentTimeframe) { currentTimeframe = cfg.currentTimeframe; setStorage('zenith_timeframe', currentTimeframe); }
            if (cfg.filters) { filters = cfg.filters; setStorage('zenith_filters', JSON.stringify(filters)); }

            // Novos campos para persistência completa
            if (cfg.scaleFontSize) { scaleFontSize = parseInt(cfg.scaleFontSize); setStorage('zenith_font_size', scaleFontSize); }
            if (cfg.scaleFontColor) { scaleFontColor = cfg.scaleFontColor; setStorage('zenith_font_color', scaleFontColor); }
            if (cfg.footprintBgColor) { footprintBgColor = cfg.footprintBgColor; setStorage('zenith_footprint_bg', footprintBgColor); }
            if (cfg.footprintFontColor) { footprintFontColor = cfg.footprintFontColor; setStorage('zenith_footprint_font', footprintFontColor); }
            if (cfg.posOutlineColor) { posOutlineColor = cfg.posOutlineColor; setStorage('zenith_pos_outline', posOutlineColor); }
            if (cfg.negOutlineColor) { negOutlineColor = cfg.negOutlineColor; setStorage('zenith_neg_outline', negOutlineColor); }
            if (cfg.lastPriceBgColor) { lastPriceBgColor = cfg.lastPriceBgColor; setStorage('zenith_last_price_bg', lastPriceBgColor); }
            if (cfg.lastPriceLineColor) { lastPriceLineColor = cfg.lastPriceLineColor; setStorage('zenith_last_price_line', lastPriceLineColor); }
            if (cfg.shortcuts) { shortcuts = cfg.shortcuts; setStorage('zenith_shortcuts', JSON.stringify(shortcuts)); }

            // Aplicar CSS e UI
            document.documentElement.style.setProperty('--theme-bg', themeColor);
            const tfDisp = document.getElementById('tf-display');
            if (tfDisp && motorStatus === 'on') {
                tfDisp.innerText = currentTimeframe.toUpperCase().replace('MIN', 'M');
            }
            else if (tfDisp) tfDisp.innerText = '---';
        }
    } catch (e) { console.warn("Erro ao carregar do servidor, usando local."); }
}

async function saveSettingsToServer() {
    const config = {
        chartBgColor, themeColor, posColor, negColor, currentTimeframe, filters,
        scaleFontSize, scaleFontColor, footprintBgColor, footprintFontColor,
        posOutlineColor, negOutlineColor, lastPriceBgColor, lastPriceLineColor,
        shortcuts
    };
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
    } catch (e) { console.error("Erro ao salvar no servidor."); }
}


// 3. ESTADO DO GRÁFICO
let priceMax = 5020, priceMin = 4980, visibleCandles = 20, horizontalScroll = 0;

let currentTimeframe = localStorage.getItem('zenith_timeframe') || "5Min";
const rightMargin = 60;
let isAutoScale = true;
let activeTool = 'none', mousePos = { x: 0, y: 0 }, isDrag = false, isDragS = false, isDragT = false, lX = 0, lY = 0, lSY = 0, lTX = 0;


let chartData = [];
let chartDataMap = new Map(); // O(1) Lookup
let hasRealData = false;
let needsHistoryRedraw = true;
let externalLastPrice = 0;
let needsScaleRedraw = true; // Flag para réguas
let needsAutoScale = true; // Flag para escala controlada
let shortcuts = JSON.parse(localStorage.getItem('zenith_shortcuts')) || {
    hand: 'KeyH',
    cross: 'KeyC',
    zoomIn: 'Equal',
    zoomOut: 'Minus',
    reset: 'Delete',
    motor: 'KeyP',
    shutdown: 'KeyX'
};

const historyCanvasCache = document.createElement('canvas');
const historyCtxCache = historyCanvasCache.getContext('2d', { alpha: true });

const staticScaleCache = document.createElement('canvas');
const staticScaleCtx = staticScaleCache.getContext('2d');
const staticTimeCache = document.createElement('canvas');
const staticTimeCtx = staticTimeCache.getContext('2d');

function generateMockData() {
    // DESATIVADO: Agora o gráfico só mostra dados REAIS vindos do seu Excel.
    console.log("🕯️ Aguardando conexão com o motor para carregar dados reais...");
    chartData = [];
    chartDataMap.clear();
}

// 5. LÓGICA DE DIMENSIONAMENTO
function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth - 75;
    const h = window.innerHeight - 75;

    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    scaleCanvas.width = 75 * dpr; scaleCanvas.height = h * dpr;
    scaleCanvas.style.width = '75px'; scaleCanvas.style.height = h + 'px';
    scaleCtx.scale(dpr, dpr);

    timeCanvas.width = w * dpr; timeCanvas.height = 35 * dpr;
    timeCanvas.style.width = w + 'px'; timeCanvas.style.height = '35px';
    timeCtx.scale(dpr, dpr);

    // Ajustar Caches
    historyCanvasCache.width = canvas.width;
    historyCanvasCache.height = canvas.height;

    staticScaleCache.width = scaleCanvas.width;
    staticScaleCache.height = scaleCanvas.height;
    staticTimeCache.width = timeCanvas.width;
    staticTimeCache.height = timeCanvas.height;

    needsHistoryRedraw = true;
    needsScaleRedraw = true;

    autoScale();
}


function autoScale() {
    if (!isAutoScale || chartData.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const cW = (canvas.width / dpr - rightMargin) / visibleCandles;

    // Cálculo de índices visíveis para evitar percorrer o histórico todo (O(Visível))
    let iStart = Math.floor((horizontalScroll - rightMargin) / cW);
    let iEnd = Math.ceil((canvas.width / dpr - rightMargin + horizontalScroll + cW) / cW);

    iStart = Math.max(0, iStart);
    iEnd = Math.min(chartData.length - 1, iEnd);

    let minH = Infinity, maxH = -Infinity;
    for (let i = iStart; i <= iEnd; i++) {
        const c = chartData[i];
        if (c.high > maxH) maxH = c.high;
        if (c.low < minH) minH = c.low;
    }

    if (chartData.length > 0) {
        // CENTRALIZAÇÃO TOTAL NO PREÇO ATUAL (Garante que nunca suma)
        const currentP = externalLastPrice || chartData[0].close;
        if (currentP > 0) {
            const currentRange = priceMax - priceMin;
            priceMax = currentP + (currentRange / 2);
            priceMin = currentP - (currentRange / 2);
            
            needsHistoryRedraw = true;
            needsScaleRedraw = true;
        }
    }
}

// 6. RENDERIZAÇÃO DE ESCALAS
function drawChevronTag(ctx, y, color, textColor, text, width) {
    const h = 20; ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(10, y - h / 2); ctx.lineTo(width, y - h / 2); ctx.lineTo(width, y + h / 2); ctx.lineTo(10, y + h / 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = textColor; ctx.font = "bold 11px Arial"; ctx.textAlign = "right"; ctx.fillText(text, width - 5, y + 4);
}

function drawScales(range) {
    const dpr = window.devicePixelRatio || 1;
    const sW = scaleCanvas.width / dpr;
    const sH = scaleCanvas.height / dpr;
    const tW = timeCanvas.width / dpr;

    // DESENHA OS FUNDOS (LAYOUT) SEMPRE
    scaleCtx.clearRect(0, 0, sW, sH);
    scaleCtx.fillStyle = chartBgColor;
    scaleCtx.fillRect(0, 0, sW, sH);

    timeCtx.clearRect(0, 0, tW, 35);
    timeCtx.fillStyle = chartBgColor; timeCtx.fillRect(0, 0, tW, 18); // Fundo Horas
    timeCtx.fillStyle = themeColor; timeCtx.fillRect(0, 18, tW, 17); // Fundo Data

    // TRAVA: Só desenha os NÚMEROS se já tivermos recebido DADOS REAIS do ativo
    if (!hasRealData) {
        staticScaleCtx.clearRect(0, 0, staticScaleCache.width, staticScaleCache.height);
        staticTimeCtx.clearRect(0, 0, staticTimeCache.width, staticTimeCache.height);
        return;
    }

    if (needsScaleRedraw) {
        // Redesenhar réguas estáticas
        staticScaleCtx.clearRect(0, 0, staticScaleCache.width, staticScaleCache.height);
        staticScaleCtx.save(); staticScaleCtx.scale(dpr, dpr);
        staticScaleCtx.fillStyle = chartBgColor; staticScaleCtx.fillRect(0, 0, sW, sH);

        const step = calculatePriceStep(range);

        staticScaleCtx.fillStyle = scaleFontColor; staticScaleCtx.font = `${scaleFontSize}px Arial`; staticScaleCtx.textAlign = "right";
        const firstP = Math.ceil(priceMin / step) * step;
        for (let p = firstP; p <= priceMax; p += step) {
            const y = sH - ((p - priceMin) / range) * sH;
            if (y >= 0 && y <= sH) staticScaleCtx.fillText(priceFormatter.format(p), sW - 5, y + 4);
        }
        staticScaleCtx.restore();

        staticTimeCtx.clearRect(0, 0, staticTimeCache.width, staticTimeCache.height);
        staticTimeCtx.save(); staticTimeCtx.scale(dpr, dpr);
        staticTimeCtx.fillStyle = chartBgColor; staticTimeCtx.fillRect(0, 0, tW, 18);
        staticTimeCtx.fillStyle = themeColor; staticTimeCtx.fillRect(0, 18, tW, 17);

        const cW = (canvas.width / dpr - rightMargin) / visibleCandles;
        staticTimeCtx.fillStyle = scaleFontColor; staticTimeCtx.font = `${scaleFontSize}px Arial`; staticTimeCtx.textAlign = "center";

        let iStart = Math.max(0, Math.floor((horizontalScroll - rightMargin) / cW));
        let iEnd = Math.min(chartData.length - 1, Math.ceil((tW + horizontalScroll) / cW));
        const skip = Math.ceil(60 / cW);

        for (let i = iStart; i <= iEnd; i++) {
            if (i % skip === 0) {
                const x = (canvas.width / dpr - rightMargin) - (i * cW) + horizontalScroll;
                if (x > 0 && x < tW) {
                    const c = chartData[i];
                    const label = `${String(c.timestamp.getHours()).padStart(2, '0')}:${String(c.timestamp.getMinutes()).padStart(2, '0')}`;
                    staticTimeCtx.fillText(label, x, 15);
                }
            }
        }

        if (chartData[0]) {
            staticTimeCtx.fillStyle = scaleFontColor; staticTimeCtx.font = `bold ${scaleFontSize}px Arial`;
            const dateStr = `${String(chartData[0].timestamp.getDate()).padStart(2, '0')}/${String(chartData[0].timestamp.getMonth() + 1).padStart(2, '0')}`;
            staticTimeCtx.fillText(dateStr, tW / 2, 30);
        }
        staticTimeCtx.restore();
        needsScaleRedraw = false;
    }

    // Renderizar caches no canvas visível
    scaleCtx.clearRect(0, 0, sW, sH);
    scaleCtx.drawImage(staticScaleCache, 0, 0, sW, sH);

    // DESENHAR ETIQUETA DE PREÇO ATUAL (CHEVRON)
    const currentPrice = externalLastPrice || (chartData[0] ? chartData[0].close : 0);
    const safeRange = (priceMax - priceMin) || 1; // Evita divisão por zero
    if (currentPrice > 0) {
        const y = sH - ((currentPrice - priceMin) / safeRange) * sH;
        if (y >= 0 && y <= sH) {
            // Fundo Laranja e Texto PRETO (Igual ao seu modelo)
            drawChevronTag(scaleCtx, y, lastPriceBgColor, "#000000", priceFormatter.format(currentPrice), sW);
        }
    }

    timeCtx.clearRect(0, 0, tW, 35);
    timeCtx.drawImage(staticTimeCache, 0, 0, tW, 35);


    if (activeTool === 'cross') {
        const y = mousePos.y, p = priceMax - (y / (canvas.height / dpr)) * range;
        drawChevronTag(scaleCtx, y, "#ffffff", "#000000", priceFormatter.format(p), sW);

        const cW = (canvas.width / dpr - rightMargin) / visibleCandles;
        const candleIdx = Math.round(((canvas.width / dpr - rightMargin) - (mousePos.x - horizontalScroll)) / cW);
        if (chartData[candleIdx]) {
            const hLabel = `${String(chartData[candleIdx].timestamp.getHours()).padStart(2, '0')}:${String(chartData[candleIdx].timestamp.getMinutes()).padStart(2, '0')}`;
            timeCtx.fillStyle = chartBgColor; timeCtx.fillRect(mousePos.x - 25, 0, 50, 18);
            timeCtx.fillStyle = "#ffffff"; timeCtx.font = `bold ${scaleFontSize}px Arial`; timeCtx.textAlign = "center";
            timeCtx.fillText(hLabel, mousePos.x, 13);
        }
    }
}

let hoverTarget = null;
let hoverStartTime = 0;

// 7. RENDERIZAÇÃO DO GRÁFICO
function draw() {
    try {
        const dpr = window.devicePixelRatio || 1;

        // Processar Escala se solicitado
        if (needsAutoScale) {
            autoScale();
            needsAutoScale = false;
        }

        // RECALCULAR RANGE BASEADO NA ALTURA FIXA DO TICK
        const tickH = verticalZoom;
        const range = ((canvas.height / dpr) / tickH) * 0.25;
        
        // Sincroniza priceMax/Min com o centro atual e o novo range
        const centerP = (priceMax + priceMin) / 2;
        priceMax = centerP + (range / 2);
        priceMin = centerP - (range / 2);

        const cW = (canvas.width / dpr - rightMargin) / visibleCandles;

        // AUTO-AJUSTE INTELIGENTE (Flexível: Para se estiver estudando com Mão ou Cruz)
        const isStudying = (activeTool === 'hand' || activeTool === 'cross' || horizontalScroll > 30);
        if (!isStudying && chartData.length > 0) {
            const currentP = externalLastPrice || chartData[0].close;
            if (currentP > 0 && (currentP > priceMax || currentP < priceMin)) {
                isAutoScale = true; // Força a volta do auto-ajuste se o preço fugir
                needsAutoScale = true;
                needsHistoryRedraw = true; // Garante que as velas antigas não sumam
            }
        }
        
        // Se o rádio não estiver verde (desconectado), o motor Status UI deve refletir

        // Lógica do botão Snap-Back (Voltar ao presente)
        const snapBtn = document.getElementById('snap-back');
        if (snapBtn) {
            if (horizontalScroll > 20) {
                snapBtn.classList.add('visible');
            } else {
                snapBtn.classList.remove('visible');
            }
        }

        // 1. REDESENHAR CACHE DE HISTÓRICO SE NECESSÁRIO
        if (needsHistoryRedraw) {
            renderHistoryToCache(range, cW, tickH);
            needsHistoryRedraw = false;
        }

        // 2. LIMPAR CANVAS PRINCIPAL
        ctx.fillStyle = chartBgColor;
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        if (chartData.length === 0) {
            drawScales(range);

            const centerX = (canvas.width / dpr) / 2; // Centro absoluto (ignora margem da régua)
            const centerY = (canvas.height / dpr) / 2;
            let statusText = "Aguardando negócios do Excel...";
            let statusColor = "rgba(255,255,255,0.5)";

            if (!socket || socket.readyState !== WebSocket.OPEN) {
                statusText = "❌ DESCONECTADO DO SERVIDOR";
                statusColor = "#f23645";
            } else if (motorStatus === 'off') {
                statusText = "Ligar Power";
                const iconColor = "#089981"; 
                const textColor = "#ffffff"; 
                
                ctx.font = "bold 26px Arial";
                const textWidth = ctx.measureText(statusText).width;
                const iconSize = 24;
                const gap = 15;
                const totalWidth = iconSize + gap + textWidth;
                const startX = centerX - (totalWidth / 2);
                
                // Desenha Ícone de Power Centralizado Verticalmente
                ctx.save();
                ctx.strokeStyle = iconColor;
                ctx.lineWidth = 3.5;
                ctx.lineCap = "round";
                const iconX = startX + iconSize/2;
                const iconY = centerY; // Centralizado no Y real
                
                ctx.beginPath();
                ctx.arc(iconX, iconY, iconSize/2, -Math.PI/3.5, Math.PI + Math.PI/3.5);
                ctx.stroke();
                
                ctx.beginPath();
                ctx.moveTo(iconX, iconY - iconSize/2);
                ctx.lineTo(iconX, iconY);
                ctx.stroke();
                ctx.restore();

                ctx.fillStyle = textColor;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle"; // Alinhamento vertical preciso
                ctx.fillText(statusText, startX + iconSize + gap, iconY + 2);
            }

            requestAnimationFrame(draw);
            return;
        }

        // 3. DESENHAR HISTÓRICO CACHEADO
        ctx.drawImage(historyCanvasCache, 0, 0, canvas.width / dpr, canvas.height / dpr);

        // 4. DESENHAR CANDLE ATUAL (LIVE)
        const currentCandle = chartData[0];
        if (currentCandle) {
            drawSingleCandle(ctx, currentCandle, 0, range, cW, tickH);
        }

        // 5. LINHA DE PREÇO ATUAL (INFINITA E DINÂMICA)
        const lastP = (externalLastPrice > 0) ? externalLastPrice : currentCandle.close;
        const yL = canvas.height / dpr - ((lastP - priceMin) / range) * (canvas.height / dpr);

        if (yL >= 0 && yL <= canvas.height / dpr) {
            ctx.save();
            ctx.strokeStyle = lastPriceLineColor || themeColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            // Começa no centro da vela atual e vai até a régua de preço
            const startX = (canvas.width / dpr - rightMargin) + horizontalScroll + (cW * 0.5);
            ctx.moveTo(startX, yL);
            ctx.lineTo(canvas.width / dpr, yL);
            ctx.stroke();
            ctx.restore();
        }


        drawScales(range);

        // 6. Camada de Interação (Mira e Tooltip) - Apenas se houver movimento recente
        if (Date.now() - lastMouseMove < 2000) {
            drawInteractionLayers(range, cW, dpr);
        }

        requestAnimationFrame(draw);
    } catch (e) { requestAnimationFrame(draw); }
}

function drawInteractionLayers(range, cW, dpr) {
    // Mira (Crosshair)
    if (activeTool === 'cross') {
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(mousePos.x, 0); ctx.lineTo(mousePos.x, canvas.height / dpr);
        ctx.moveTo(0, mousePos.y); ctx.lineTo(canvas.width / dpr, mousePos.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Lógica do Tooltip (Movida para cá para economizar processamento)
    processTooltip(range, cW, dpr);
}

function processTooltip(range, cW, dpr) {
    let hoveredCandle = null;
    let iStartH = Math.max(0, Math.floor((horizontalScroll - rightMargin) / cW));
    let iEndH = Math.min(chartData.length - 1, Math.ceil((canvas.width / dpr - rightMargin + horizontalScroll + cW) / cW));

    for (let i = iStartH; i <= iEndH; i++) {
        const c = chartData[i];
        const x = (canvas.width / dpr - rightMargin) - (i * cW) + horizontalScroll;
        const yH = canvas.height / dpr - ((c.high - priceMin) / range) * (canvas.height / dpr);
        const yL = canvas.height / dpr - ((c.low - priceMin) / range) * (canvas.height / dpr);

        if (Math.abs(mousePos.x - x) < cW / 2 && mousePos.x < (canvas.width / dpr - rightMargin) && mousePos.y >= yH && mousePos.y <= yL) {
            hoveredCandle = c; break;
        }
    }

    if (hoveredCandle) {
        if (!hoverTarget || hoverTarget.timestamp.getTime() !== hoveredCandle.timestamp.getTime()) {
            hoverTarget = hoveredCandle; hoverStartTime = Date.now();
        }
        if (Date.now() - hoverStartTime >= 3000) {
            candleTooltip.style.display = 'block';
            candleTooltip.style.left = (mousePos.x + 15) + 'px';
            candleTooltip.style.top = (mousePos.y + 15) + 'px';
            document.getElementById('tt-header').innerText = `Resumo de ${hoveredCandle.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            document.getElementById('tt-open').innerText = priceFormatter.format(hoveredCandle.open);
            document.getElementById('tt-close').innerText = priceFormatter.format(hoveredCandle.close);
            document.getElementById('tt-high').innerText = priceFormatter.format(hoveredCandle.high);
            document.getElementById('tt-low').innerText = priceFormatter.format(hoveredCandle.low);
        } else { candleTooltip.style.display = 'none'; }
    } else { hoverTarget = null; candleTooltip.style.display = 'none'; }
}

let lastMouseMove = Date.now();
canvas.addEventListener('mousemove', () => { lastMouseMove = Date.now(); });

// 7.1 FUNÇÕES DE OTIMIZAÇÃO DE DESENHO
function renderHistoryToCache(range, cW, tickH) {
    const dpr = window.devicePixelRatio || 1;
    const canvasW = canvas.width / dpr;
    historyCtxCache.clearRect(0, 0, historyCanvasCache.width, historyCanvasCache.height);
    historyCtxCache.save();
    historyCtxCache.scale(dpr, dpr);

    // Otimização O(Visível)
    let iStart = Math.floor((horizontalScroll - rightMargin) / cW);
    let iEnd = Math.ceil((canvasW - rightMargin + horizontalScroll + cW) / cW);

    iStart = Math.max(1, iStart);
    iEnd = Math.min(chartData.length - 1, iEnd);

    // Desenha do mais antigo para o mais novo (dentro do intervalo visível) para manter ordem lógica
    for (let i = iEnd; i >= iStart; i--) {
        drawSingleCandle(historyCtxCache, chartData[i], i, range, cW, tickH);
    }
    historyCtxCache.restore();
}

// Função para adicionar apenas uma vela ao cache (sem redesenhar tudo)
function appendToHistoryCache(candle, index, range, cW, tickH) {
    const dpr = window.devicePixelRatio || 1;
    historyCtxCache.save();
    historyCtxCache.scale(dpr, dpr);
    drawSingleCandle(historyCtxCache, candle, index, range, cW, tickH);
    historyCtxCache.restore();
}

function drawSingleCandle(targetCtx, c, i, range, cW, tickH) {
    const dpr = window.devicePixelRatio || 1;
    const canvasH = canvas.height / dpr;
    const x = (canvas.width / dpr - rightMargin) - (i * cW) + horizontalScroll;
    
    // Posições Verticais
    const yO = canvasH - ((c.open - priceMin) / range) * canvasH;
    const yC = canvasH - ((c.close - priceMin) / range) * canvasH;
    const yH = canvasH - ((c.high - priceMin) / range) * canvasH;
    const yL = canvasH - ((c.low - priceMin) / range) * canvasH;
    
    const uW = cW * 0.90;
    const isBull = c.close >= c.open;
    const color = isBull ? posOutlineColor : negOutlineColor;

    // --- MODO 1: CANDLE TRADICIONAL (Zoom Longe / cW < 50) ---
    if (cW < 50) {
        targetCtx.save();
        targetCtx.strokeStyle = color;
        targetCtx.lineWidth = Math.max(1, cW * 0.1);
        
        // Desenha o Pavio (Wick)
        targetCtx.beginPath();
        targetCtx.moveTo(x, yH);
        targetCtx.lineTo(x, yL);
        targetCtx.stroke();
        
        // Desenha o Corpo (Body)
        targetCtx.fillStyle = color;
        const bodyH = Math.max(1, Math.abs(yC - yO));
        targetCtx.fillRect(x - uW / 2, Math.min(yO, yC), uW, bodyH);
        
        targetCtx.restore();
        return; // Finaliza aqui para não desenhar os números (Footprint)
    }

    // --- MODO 2: FOOTPRINT DETALHADO (Zoom Perto / cW >= 50) ---
    const bW = uW * 0.55, mBW = uW * 0.25;

    // Borda da Vela (Afinada para 1.0)
    targetCtx.beginPath();
    targetCtx.strokeStyle = color; 
    targetCtx.lineWidth = 1.0;
    targetCtx.strokeRect(x - uW / 2, Math.min(yO, yC), uW, Math.max(1, Math.abs(yC - yO)));
    targetCtx.stroke();

    if (!c.maxV) {
        let mv = 1; Object.values(c.ticks).forEach(t => { if (t.buy + t.sell > mv) mv = t.buy + t.sell; });
        c.maxV = mv;
    }

    targetCtx.font = "bold 10px Arial"; // Negrito para garantir nitidez máxima
    targetCtx.textAlign = "center";
    targetCtx.textBaseline = "middle"; 

    // LOOP POR TODOS OS NÍVEIS DE PREÇO (Evita buracos no candle)
    for (let pNum = c.low; pNum <= c.high + 0.01; pNum += 0.25) {
        if (pNum < priceMin - 0.5 || pNum > priceMax + 0.5) continue;

        const pS = pNum.toFixed(2);
        const t = c.ticks[pS] || { buy: 0, sell: 0 }; // Se não existe, cria um fake com zero
        const y = canvasH - ((pNum - priceMin) / range) * canvasH;
        const s = t.buy - t.sell;

        // Filtros (Big Players) - Só desenha se houver saldo real
        if (t.buy + t.sell > 0) {
            filters.forEach(f => {
                if (Math.abs(s) >= f.balance) {
                    targetCtx.fillStyle = hexToRgba(f.color, f.opacity);
                    const filterWidth = (uW / 2) - (bW / 4);
                    targetCtx.fillRect(x - uW / 2, y - 6.5, filterWidth, 13);
                }
            });
        }

        const boxH = Math.max(1, tickH); 
        const startY = y - tickH / 2;    
        targetCtx.fillStyle = footprintBgColor;
        targetCtx.fillRect(Math.round(x - bW / 4), startY, Math.round(bW / 2), boxH);

        if (t.buy + t.sell > 0) {
            const isPosLevel = s >= 0;
            targetCtx.fillStyle = isPosLevel ? hexToRgba(posColor, 100) : hexToRgba(negColor, 100);
            targetCtx.fillRect(Math.round(x + bW / 4), Math.round(y - 6.5), Math.round(((t.buy + t.sell) / c.maxV) * mBW), 13);
        }

        if (tickH > 14) {
            if (t.buy + t.sell > 0) {
                const isPosLevel = s >= 0;
                // Saldo (Delta) à esquerda
                targetCtx.fillStyle = isPosLevel ? posColor : negColor;
                targetCtx.textAlign = "right";
                targetCtx.fillText(s, Math.round(x - (bW / 4) - 6), Math.round(y));

                // Volume Total ao centro
                targetCtx.fillStyle = footprintFontColor;
                targetCtx.textAlign = "center";
                targetCtx.fillText(t.buy + t.sell, Math.round(x), Math.round(y));
            } else {
                // Nível sem negociação: Desenha apenas o traço
                targetCtx.fillStyle = "rgba(255,255,255,0.2)";
                targetCtx.textAlign = "center";
                targetCtx.fillText("-", Math.round(x), Math.round(y));
            }
        }
    }
}

// 8. INTERATIVIDADE E UI
// 8. INTERATIVIDADE E UI
canvas.onwheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mX = (e.clientX - rect.left) * (canvas.width / rect.width);
    
    if (e.ctrlKey) {
        // Zoom Vertical (Preço)
        const delta = e.deltaY > 0 ? -2 : 2;
        verticalZoom = Math.max(10, Math.min(100, verticalZoom + delta));
    } else {
        // Zoom Horizontal (Tempo) ancorado no Cursor
        handleZoom(e.deltaY < 0 ? 1 : -1, mX);
    }
    needsAutoScale = true;
    needsHistoryRedraw = true;
    draw();
};

canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    mousePos.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    if (isDrag) {
        const dX = e.clientX - lX;
        const dY = e.clientY - lY;
        lX = e.clientX;
        lY = e.clientY;
        
        horizontalScroll += dX;
        
        // Se arrastar verticalmente, desativa o auto-ajuste temporariamente
        if (Math.abs(dY) > 2) isAutoScale = false;
        
        const r = priceMax - priceMin;
        const priceDelta = (dY / canvas.height) * r;
        priceMax += priceDelta;
        priceMin += priceDelta;
        
        needsHistoryRedraw = true;
        needsScaleRedraw = true;
        draw();
    }
};

canvas.onmousedown = (e) => {
    if (isModalOpen()) return;
    if (activeTool === 'hand' || e.button === 0) {
        isDrag = true;
        lX = e.clientX;
        lY = e.clientY;
        canvas.style.cursor = 'grabbing';
    }
};

canvas.onmouseup = () => {
    isDrag = false;
    if (activeTool === 'hand') canvas.style.cursor = 'grab';
    else if (activeTool === 'cross') canvas.style.cursor = 'crosshair';
    else canvas.style.cursor = 'default';
};
window.onmouseup = () => { isDrag = false; canvas.style.cursor = activeTool === 'hand' ? 'grab' : (activeTool === 'cross' ? 'crosshair' : 'default'); };
scaleCanvas.onmousedown = (e) => { if (isModalOpen()) return; isDragS = true; lSY = e.clientY; };
window.addEventListener('mousemove', (e) => {
    if (isDragS) {
        isAutoScale = false; 
        const dY = lSY - e.clientY; 
        lSY = e.clientY;
        
        // No modo fixo, arrastar a escala muda o TAMANHO da caixa (Zoom)
        verticalZoom += dY * 0.1;
        verticalZoom = Math.min(100, Math.max(5, verticalZoom));
        
        needsHistoryRedraw = true; 
        needsScaleRedraw = true;
    }
    if (isDragT) {
        const dX = e.clientX - lTX; lTX = e.clientX;
        const f = dX * (visibleCandles / (timeCanvas.width * 0.5)); // Sensibilidade ajustada
        visibleCandles -= f; visibleCandles = Math.min(100, Math.max(1, visibleCandles));
        needsHistoryRedraw = true; needsScaleRedraw = true;
    }
});
window.addEventListener('mouseup', () => { isDragS = false; isDragT = false; });
timeCanvas.onmousedown = (e) => { if (isModalOpen()) return; isDragT = true; lTX = e.clientX; };

loadSettingsFromServer().then(() => {
    connectMotor();
    updateMotorUI(); // Garante o visual correto ao carregar
    resize(); draw();
});





// UI EVENTS
function updateToolUI() {
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    if (activeTool === 'cross') document.getElementById('tool-cross').classList.add('active');
    if (activeTool === 'hand') document.getElementById('tool-hand').classList.add('active');
}

function syncInputsToState() {
    document.getElementById('input-chart-bg').value = chartBgColor;
    document.getElementById('input-theme-bg').value = themeColor;
    document.getElementById('input-pos-color').value = posColor;

    document.getElementById('input-neg-color').value = negColor;
    document.getElementById('input-pos-outline').value = posOutlineColor;
    document.getElementById('input-neg-outline').value = negOutlineColor;
    document.getElementById('input-font-size').value = scaleFontSize;
    document.getElementById('input-font-color').value = scaleFontColor;
    document.getElementById('input-footprint-bg').value = footprintBgColor.startsWith('rgba') ? '#1e222d' : footprintBgColor;
    document.getElementById('input-footprint-font-color').value = footprintFontColor;
    document.getElementById('input-last-price-bg').value = lastPriceBgColor;
    document.getElementById('input-last-price-line').value = lastPriceLineColor;




    // Atualizar as pré-visualizações visuais (círculos)
    document.querySelectorAll('.custom-color-picker').forEach(picker => {
        const input = picker.querySelector('input[type="color"]');
        const preview = picker.querySelector('.color-preview');
        const valueSpan = picker.querySelector('.color-value');
        if (input && preview) preview.style.backgroundColor = input.value;
        if (input && valueSpan) valueSpan.innerText = input.value.toUpperCase();
    });
}

document.getElementById('tool-settings').onclick = () => {
    syncInputsToState();
    // Resetar para aba Geral ao abrir
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.nav-tab[data-tab="geral"]').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('content-geral').classList.add('active');
    document.getElementById('current-tab-title').innerText = "Geral";

    // Restaurar e desenhar tudo ao abrir
    syncInputsToState();
    renderFiltersUI();

    // Iniciar memória temporária (staging)
    tempSettings = {
        chartBgColor, themeColor, lastPriceBgColor, lastPriceLineColor, posColor, negColor,
        posOutlineColor, negOutlineColor, scaleFontSize, scaleFontColor, footprintBgColor, footprintFontColor
    };

    settingsOverlay.classList.add('active');
};


// LÓGICA DE ABAS (PASSO 7)
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.onclick = () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('content-' + target).classList.add('active');
        document.getElementById('current-tab-title').innerText = tab.innerText;

        if (target === 'atalhos') {
            initShortcutRecording();
        }
    };
});


document.getElementById('tool-cross').onclick = () => { activeTool = activeTool === 'cross' ? 'none' : 'cross'; canvas.style.cursor = activeTool === 'cross' ? 'crosshair' : 'default'; updateToolUI(); };
document.getElementById('tool-hand').onclick = () => { activeTool = activeTool === 'hand' ? 'none' : 'hand'; canvas.style.cursor = activeTool === 'hand' ? 'grab' : 'default'; updateToolUI(); };
document.getElementById('tool-search').onclick = () => { searchOverlay.classList.add('active'); searchInput.value = ''; searchInput.focus(); };
document.getElementById('tool-zoom-in').onclick = () => handleZoom(1);
document.getElementById('tool-zoom-out').onclick = () => handleZoom(-1);
document.getElementById('conn-status').onclick = function () { this.classList.toggle('on'); this.classList.toggle('off'); };
// Sincronização em tempo real e salvamento individual
function updatePickerUI(input) {
    const parent = input.closest('.custom-color-picker');
    if (parent) {
        const preview = parent.querySelector('.color-preview');
        const valueSpan = parent.querySelector('.color-value');
        if (preview) preview.style.backgroundColor = input.value;
        if (valueSpan) valueSpan.innerText = input.value.toUpperCase();
    }
}

document.getElementById('input-chart-bg').oninput = function () { tempSettings.chartBgColor = this.value; updatePickerUI(this); };
document.getElementById('input-theme-bg').oninput = function () { tempSettings.themeColor = this.value; updatePickerUI(this); };
document.getElementById('input-pos-color').oninput = function () { tempSettings.posColor = this.value; updatePickerUI(this); };

document.getElementById('input-neg-color').oninput = function () { tempSettings.negColor = this.value; updatePickerUI(this); };
document.getElementById('input-pos-outline').oninput = function () { tempSettings.posOutlineColor = this.value; updatePickerUI(this); };
document.getElementById('input-neg-outline').oninput = function () { tempSettings.negOutlineColor = this.value; updatePickerUI(this); };
document.getElementById('input-font-size').oninput = function () { tempSettings.scaleFontSize = parseInt(this.value); };
document.getElementById('input-font-color').oninput = function () { tempSettings.scaleFontColor = this.value; updatePickerUI(this); };
document.getElementById('input-footprint-bg').oninput = function () { tempSettings.footprintBgColor = this.value; updatePickerUI(this); };
document.getElementById('input-footprint-font-color').oninput = function () { tempSettings.footprintFontColor = this.value; updatePickerUI(this); };
document.getElementById('input-last-price-bg').oninput = function () { tempSettings.lastPriceBgColor = this.value; updatePickerUI(this); };
document.getElementById('input-last-price-line').oninput = function () { tempSettings.lastPriceLineColor = this.value; updatePickerUI(this); };




document.getElementById('confirm-settings').onclick = () => {
    // Aplicar memória temporária para as variáveis reais
    chartBgColor = tempSettings.chartBgColor;
    themeColor = tempSettings.themeColor;
    posColor = tempSettings.posColor;
    negColor = tempSettings.negColor;
    posOutlineColor = tempSettings.posOutlineColor;
    negOutlineColor = tempSettings.negOutlineColor;

    lastPriceBgColor = tempSettings.lastPriceBgColor;

    lastPriceLineColor = tempSettings.lastPriceLineColor;
    scaleFontSize = tempSettings.scaleFontSize;
    scaleFontColor = tempSettings.scaleFontColor;
    footprintBgColor = tempSettings.footprintBgColor;
    footprintFontColor = tempSettings.footprintFontColor;

    // Salvar no Storage
    setStorage('zenith_bg_color', chartBgColor);
    setStorage('zenith_theme_color', themeColor);
    setStorage('zenith_last_price_bg', lastPriceBgColor);
    setStorage('zenith_last_price_line', lastPriceLineColor);
    setStorage('zenith_pos_color', posColor);
    setStorage('zenith_neg_color', negColor);
    setStorage('zenith_pos_outline', posOutlineColor);
    setStorage('zenith_neg_outline', negOutlineColor);
    setStorage('zenith_font_size', scaleFontSize);
    setStorage('zenith_font_color', scaleFontColor);
    setStorage('zenith_footprint_bg', footprintBgColor);
    setStorage('zenith_footprint_font', footprintFontColor);




    // Atualizar visual global (CSS)
    document.documentElement.style.setProperty('--theme-bg', themeColor);

    settingsOverlay.classList.remove('active');
    needsHistoryRedraw = true;
    saveSettingsToServer();
};


document.getElementById('cancel-settings').onclick = () => settingsOverlay.classList.remove('active');
document.getElementById('close-settings').onclick = () => settingsOverlay.classList.remove('active');
document.getElementById('add-filter-btn').onclick = () => { filters.push({ balance: 500, color: '#f23645', opacity: 80 }); renderFiltersUI(); };

if (searchInput) {
    searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            const val = searchInput.value.trim();
            if (val) {
                currentTimeframe = val.toUpperCase().endsWith('P') ? val.toLowerCase() : val + "Min";
                document.getElementById('tf-display').innerText = currentTimeframe.toUpperCase().replace('MIN', 'M');
                localStorage.setItem('zenith_timeframe', currentTimeframe);

                // RE-AGREGAÇÃO ULTRA-RÁPIDA (SEM INTERNET)
                reaggregateChart();

                searchOverlay.classList.remove('active');
                searchInput.value = '';
                saveSettingsToServer();
                return;
            }
            searchOverlay.classList.remove('active'); searchInput.value = '';


        }
    };
}

function renderFiltersUI() {
    if (!filterContainer) return;
    filterContainer.innerHTML = '';
    filters.forEach((f, i) => {
        const div = document.createElement('div');
        div.className = 'filter-card';
        div.innerHTML = `
            <button class="f-rmv" data-i="${i}" title="Remover Filtro">&times;</button>
            <div class="filter-grid">
                <div class="filter-group">
                    <label for="f-qty-${i}">Quantidade</label>
                    <input type="number" id="f-qty-${i}" name="f-qty-${i}" class="custom-input f-qty" value="${f.balance}" data-i="${i}">
                </div>
                <div class="filter-group">
                    <label for="f-clr-${i}">Cor</label>
                    <div class="custom-color-picker" style="position:relative">
                        <div class="color-preview" style="background-color: ${f.color};"></div>
                        <span class="color-value">${f.color.toUpperCase()}</span>
                        <svg class="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        <input type="color" id="f-clr-${i}" name="f-clr-${i}" class="f-clr" value="${f.color}" data-i="${i}" style="position:absolute; opacity:0; width:100%; height:100%; top:0; left:0; cursor:pointer;">
                    </div>
                </div>
                <div class="filter-group">
                    <label for="f-opc-${i}">Opacidade</label>
                    <input type="number" id="f-opc-${i}" name="f-opc-${i}" class="custom-input f-opc" value="${f.opacity}" data-i="${i}" min="0" max="100">
                </div>
            </div>
        `;
        filterContainer.appendChild(div);
    });
    setStorage('zenith_filters', JSON.stringify(filters));
}


// Delegação de Eventos para Filtros
if (filterContainer) {
    filterContainer.oninput = (e) => {
        const i = e.target.getAttribute('data-i');
        if (e.target.classList.contains('f-qty')) filters[i].balance = parseInt(e.target.value) || 0;
        if (e.target.classList.contains('f-clr')) {
            filters[i].color = e.target.value;
            updatePickerUI(e.target);
        }
        if (e.target.classList.contains('f-opc')) filters[i].opacity = parseInt(e.target.value) || 0;
        setStorage('zenith_filters', JSON.stringify(filters));
    };

    filterContainer.onclick = (e) => {
        if (e.target.classList.contains('f-rmv')) {
            const i = e.target.getAttribute('data-i');
            filters.splice(i, 1);
            renderFiltersUI();
        }
    };
}

// Fechar ao clicar no fundo
searchOverlay.onclick = (e) => { if (e.target === searchOverlay) searchOverlay.classList.remove('active'); };
settingsOverlay.onclick = (e) => { if (e.target === settingsOverlay) settingsOverlay.classList.remove('active'); };

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        settingsOverlay.classList.remove('active');
        searchOverlay.classList.remove('active');
    }
    // Atalho: Digitar para pesquisar (Apenas Números ou 'P' para Pontos)
    if (!isModalOpen() && !e.ctrlKey && !e.altKey && /^[0-9p]$/i.test(e.key)) {
        searchOverlay.classList.add('active');
        searchInput.value = e.key.toUpperCase();
        searchInput.focus();
        e.preventDefault();
    }
});
// LÓGICA DO MOTOR
function connectMotor() {
    // Se já estiver conectando ou aberto, não faz nada
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
    
    if (socket) socket.close();

    // Força WSS na nuvem (Render) e WS no local
    // Força IPv4 no local para evitar erro de handshake no Windows
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const protocol = isLocal ? 'ws:' : 'wss:';
    const host = isLocal ? `127.0.0.1:${window.location.port || 10000}` : window.location.host;

    socket = new WebSocket(`${protocol}//${host}`);

    const statusIcon = document.getElementById('conn-status');
    if (statusIcon) statusIcon.style.color = '#ff9800';

    socket.onopen = () => {
        console.log("[WS]: Rádio conectado. Sincronizando estado...");
        if (statusIcon) statusIcon.style.color = '#089981'; // Verde Zenith
        
        const isRunning = (motorStatus === 'on');
        socket.send(JSON.stringify({ type: 'TOGGLE_MOTOR', running: isRunning }));
        
        // Sempre pede o histórico ao conectar (resolve o problema do F5)
        socket.send(JSON.stringify({ type: 'GET_HISTORY' }));
    };

    socket.onclose = () => {
        if (statusIcon) statusIcon.style.color = '#f23645'; // Vermelho
        setTimeout(connectMotor, 3000); // Tenta reconectar em 3s
    };

    socket.onerror = () => {
        if (statusIcon) statusIcon.style.color = '#f23645'; // Vermelho
    };

    socket.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);

            if (msg.type === 'MOTOR_STATUS') {
                const wasOff = motorStatus === 'off';
                motorStatus = msg.running ? 'on' : 'off';
                setStorage('zenith_motor', motorStatus);
                updateMotorUI();

                if (!msg.running) {
                    // Resetar informações visuais ao desligar
                    const assetElem = document.querySelector('.asset-name');
                    const varElem = document.getElementById('variation');
                    if (assetElem) assetElem.innerHTML = `--- <span id="tf-display">---</span>`;
                    if (varElem) { varElem.innerText = '---%'; varElem.style.color = '#787b86'; varElem.style.opacity = '0.5'; }
                    // hasRealData = false; // Removido para manter o histórico visível no F5
                }

                if (wasOff && msg.running && socket.readyState === WebSocket.OPEN) {
                    console.log("[WS]: Motor religado. Sincronia mantida.");
                }
            }

            if (msg.type === 'MARKET_DATA' || msg.type === 'NEW_TRADES' || msg.type === 'NEW_DATA') {
                // Limpeza de avisos (SÓ ESCONDE SE NÃO FOR HISTÓRICO)
                if (msg.asset !== "HISTORICO") {
                    const ov = document.getElementById('waiting-data');
                    if (ov) ov.style.display = 'none';
                }
                // Atualiza o Ativo e Variação vindo do Excel (A2 e H2)
                if (msg.asset) {
                    const assetElem = document.querySelector('.asset-name');
                    if (assetElem) {
                        const tfLabel = currentTimeframe.toUpperCase().replace('MIN', 'M');
                        assetElem.innerHTML = `${msg.asset} <span id="tf-display">${tfLabel}</span>`;
                    }
                }

                if (msg.lastPrice > 0) {
                    externalLastPrice = msg.lastPrice;
                    if (!hasRealData) {
                        hasRealData = true;
                        
                        // Ajusta a escala para o preço real (Nasdaq 28k)
                        const range = 50;
                        priceMax = externalLastPrice + (range / 2);
                        priceMin = externalLastPrice - (range / 2);

                        // Esconde o overlay de "Aguardando Dados" (tenta ID e Classe)
                        const overlay = document.getElementById('waiting-data') || document.querySelector('.waiting-data-overlay') || document.querySelector('.waiting-data');
                        if (overlay) overlay.style.display = 'none';
                    }
                }

                if (msg.variation !== undefined) {
                    const varElem = document.getElementById('variation');
                    if (varElem) {
                        const v = msg.variation || 0;
                        const sign = v > 0 ? '+' : '';
                        varElem.innerText = sign + v.toFixed(2) + '%';
                        varElem.style.color = v >= 0 ? '#089981' : '#f23645';
                        varElem.style.opacity = '1';
                    }
                }

                needsScaleRedraw = true;
            }

            if (msg.type === 'START_HISTORY') {
                isMountingHistory = true;
                const ov = document.getElementById('waiting-data');
                if (ov) {
                    ov.style.display = 'flex';
                    const textElem = ov.querySelector('.waiting-text');
                    if (textElem) textElem.innerText = "MONTANDO O GRÁFICO...";
                }
                // Limpa o estado para receber o novo bloco massivo
                chartData = []; chartDataMap.clear(); processedTradeIds.clear(); rawTrades = [];
            }

            if (msg.type === 'END_HISTORY') {
                isMountingHistory = false;
                setTimeout(() => {
                    try {
                        reaggregateChart();
                        
                        if (!hasRealData && chartData.length > 0) {
                            hasRealData = true;
                            const lastC = chartData[0];
                            externalLastPrice = lastC.close;
                            autoScale();
                        }
                    } catch (e) {
                        console.error("Erro fatal ao reagrupar histórico:", e);
                    } finally {
                        const ov = document.getElementById('waiting-data');
                        if (ov) ov.style.display = 'none';

                        historyCanvasCache.width = historyCanvasCache.width; 
                        needsHistoryRedraw = true;
                        draw();
                    }
                }, 500); 
            }

            if (msg.type === 'HISTORICAL_TRADES' || msg.type === 'HISTORY_DATA') {
                const list = msg.trades || msg.data;
                if (list && list.length > 0) {
                    // Se for um bloco único do servidor, faz o processo completo
                    processTrades(list);
                    reaggregateChart();
                    draw();
                }
                const ov = document.getElementById('waiting-data');
                if (ov) ov.style.display = 'none';
            }

            if (msg.type === 'NEW_TRADES' || msg.type === 'NEW_TRADE' || msg.type === 'NEW_DATA') {
                const list = msg.trades || msg.data || (msg.id ? [msg] : null);
                if (list && list.length > 0) {
                    if (isMountingHistory) {
                        rawTrades.push(...list);
                    } else {
                        processTrades(list);
                    }
                }
            }

            if (msg.type === 'CLEAR_CHART') {
                chartData = []; chartDataMap.clear(); processedTradeIds.clear(); rawTrades = [];
                needsHistoryRedraw = true; draw();
            }

            if (msg.type === 'PYTHON_DISCONNECT') {
                console.warn("[WS]: ALERTA - Conexão com o Motor Python perdida!");
                const ov = document.getElementById('waiting-data');
                if (ov) {
                    ov.style.display = 'flex';
                    const textElem = ov.querySelector('.waiting-text');
                    if (textElem) textElem.innerText = "MOTOR PYTHON DESCONECTADO... Aguardando reconexão.";
                }
            }

            if (msg.type === 'PYTHON_CONNECT') {
                console.log("[WS]: Motor Python conectado e pronto!");
                const ov = document.getElementById('waiting-data');
                if (ov) {
                    const textElem = ov.querySelector('.waiting-text');
                    if (textElem && textElem.innerText.includes("PYTHON DESCONECTADO")) {
                        ov.style.display = 'none';
                    }
                }
            }
        } catch (err) { console.error("Erro no processamento:", err); }
    };

    socket.onerror = () => { if (statusIcon) statusIcon.style.color = '#f23645'; };
    socket.onclose = () => {
        if (statusIcon) statusIcon.style.color = '#f23645';
        if (motorStatus === 'on') setTimeout(connectMotor, 3000);
    };
}

function processTrades(trades) {
    if (!trades || !Array.isArray(trades)) return;

    const isPointChart = currentTimeframe.toUpperCase().endsWith('P');
    let addedNewCandle = false;

    const tickValue = 0.25;
    const ticksPerCandle = isPointChart ? (parseInt(currentTimeframe) || 10) : 0;
    const pointLimit = ticksPerCandle * tickValue;

    let tfMs = 0;
    if (!isPointChart) {
        let tfMin = parseInt(currentTimeframe) || 5;
        if (currentTimeframe.toUpperCase().includes('H')) tfMin *= 60;
        if (currentTimeframe.toUpperCase().includes('D')) tfMin *= 1440;
        tfMs = tfMin * 60 * 1000;
    }

    trades.forEach(t => {
        if (t.price > 1000000) t.price = t.price / 10;
        if (!t.id || processedTradeIds.has(t.id)) return;
        processedTradeIds.add(t.id);
        rawTrades.push(t);

        if (rawTrades.length > 1000000) {
            const removed = rawTrades.shift();
            processedTradeIds.delete(removed.id);
        }

        const ts = Number(t.timestamp);
        if (isNaN(ts)) return;

        if (isPointChart) {
            // No Gráfico de Pontos, o mais novo é SEMPRE o chartData[0]
            let candle = chartData[0];

            if (!candle) {
                candle = {
                    timestamp: new Date(ts),
                    open: t.price, high: t.price, low: t.price, close: t.price,
                    ticks: {}, maxV: 0, isPoint: true
                };
                chartData.unshift(candle);
                addedNewCandle = true;
            }

            let currentPrice = t.price;
            let finishedProcessingTrade = false;

            while (!finishedProcessingTrade) {
                const diff = currentPrice - candle.open;

                if (Math.abs(diff) >= pointLimit) {
                    const direction = diff > 0 ? 1 : -1;
                    candle.close = candle.open + (direction * pointLimit);
                    
                    if (direction > 0) candle.high = Math.max(candle.high, candle.close);
                    else candle.low = Math.min(candle.low, candle.close);

                    const nextOpen = candle.close;
                    candle = {
                        timestamp: new Date(ts),
                        open: nextOpen, high: nextOpen, low: nextOpen, close: nextOpen,
                        ticks: {}, maxV: 0, isPoint: true
                    };
                    chartData.unshift(candle); // NOVO CANDLE NO TOPO
                    addedNewCandle = true;
                } else {
                    candle.close = currentPrice;
                    if (currentPrice > candle.high) candle.high = currentPrice;
                    if (currentPrice < candle.low) candle.low = currentPrice;

                    const pS = currentPrice.toFixed(2);
                    if (!candle.ticks[pS]) candle.ticks[pS] = { buy: 0, sell: 0, p: currentPrice };
                    if (t.side.toUpperCase() === 'BUY') candle.ticks[pS].buy += t.quantity;
                    else candle.ticks[pS].sell += t.quantity;

                    const totalV = candle.ticks[pS].buy + candle.ticks[pS].sell;
                    if (totalV > (candle.maxV || 0)) candle.maxV = totalV;
                    
                    finishedProcessingTrade = true;
                }
            }
        } else {
            const candleTime = Math.floor(ts / tfMs) * tfMs;
            let candle = chartDataMap.get(candleTime);

            if (!candle) {
                candle = {
                    timestamp: new Date(candleTime),
                    open: t.price, high: t.price, low: t.price, close: t.price,
                    ticks: {}, maxV: 0
                };
                chartData.push(candle);
                chartDataMap.set(candleTime, candle);
                addedNewCandle = true;
            }

            candle.close = t.price;
            if (t.price > candle.high) candle.high = t.price;
            if (t.price < candle.low) candle.low = t.price;

            const pS = t.price.toFixed(2);
            if (!candle.ticks[pS]) candle.ticks[pS] = { buy: 0, sell: 0, p: t.price };
            if (t.side.toUpperCase() === 'BUY') candle.ticks[pS].buy += t.quantity;
            else candle.ticks[pS].sell += t.quantity;

            const totalV = candle.ticks[pS].buy + candle.ticks[pS].sell;
            if (totalV > (candle.maxV || 0)) candle.maxV = totalV;
        }
    });

    if (addedNewCandle) {
        // SÓ organiza para Gráficos de TEMPO. 
        // Pontos já estão na ordem correta via unshift()
        if (!isPointChart) {
            chartData.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        }
        
        needsHistoryRedraw = true;
        needsScaleRedraw = true;
        if (chartData.length > 0) autoScale();
    }
}

// Função de RE-AGREGAÇÃO ULTRA-RÁPIDA (Local)
function reaggregateChart() {
    chartData = [];
    chartDataMap.clear();
    const currentProcessedIds = new Set(processedTradeIds); // Backup
    processedTradeIds.clear(); // Limpa para re-processar

    // Processa tudo da memória RAM (sem rede)
    const backupRaw = [...rawTrades];
    rawTrades = [];
    processTrades(backupRaw);

    autoScale();
    draw();
}




function updateMotorUI() {
    const btn = document.getElementById('motor-toggle');
    const statusIcon = document.getElementById('conn-status');
    if (!btn) return;

    // 1. ATUALIZAÇÃO DO BOTÃO PRINCIPAL (MOTOR)
    if (motorStatus === 'on') {
        btn.classList.add('on');
        btn.classList.remove('off');
    } else {
        btn.classList.add('off');
        btn.classList.remove('on');

        // Resetar informações visuais (Mas MANTER hasRealData como true se houver histórico)
        const assetElem = document.querySelector('.asset-name');
        const varElem = document.getElementById('variation');
        if (assetElem) assetElem.innerHTML = `--- <span id="tf-display">---</span>`;
        if (varElem) { varElem.innerText = '---%'; varElem.style.color = '#787b86'; varElem.style.opacity = '0.5'; }
    }

    // O ícone de status (rádio) agora é gerenciado 100% pelos eventos do WebSocket (onopen, onclose, etc)
}



// LÓGICA DE CLIQUE GLOBAL (À PROVA DE FALHAS)
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#motor-toggle');
    if (btn) {
        const newStatus = (motorStatus === 'on') ? 'off' : 'on';

        motorStatus = newStatus;
        updateMotorUI();
        setStorage('zenith_motor', motorStatus);

        if (newStatus === 'on') {
            const ov = document.getElementById('waiting-data');
            if (ov) {
                ov.style.display = 'flex';
                const textElem = ov.querySelector('.waiting-text');
                if (textElem) textElem.innerText = "AGUARDANDO DADOS...";
            }
        } else {
            const ov = document.getElementById('waiting-data');
            if (ov) ov.style.display = 'none';
        }

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ 
                type: 'TOGGLE_MOTOR', 
                running: (motorStatus === 'on') 
            }));
        } else if (newStatus === 'on') {
            connectMotor();
        }
    }

    // BOTÃO SNAP-BACK
    const snapBtn = e.target.closest('#snap-back');
    if (snapBtn) {
        horizontalScroll = 0;
        isAutoScale = true; // REATIVA O AUTO-AJUSTE VERTICAL
        needsAutoScale = true;
        needsHistoryRedraw = true;
        draw();
    }
});

// 8. CONTROLES DE ZOOM E PAN (v8.6)
function handleZoom(delta, mouseX) {
    const oldVisible = visibleCandles;
    const zoomSpeed = 0.9; // Ajuste de sensibilidade
    
    // 1. Calcula a largura do candle ANTES do zoom
    const cwBefore = (canvas.width - rightMargin) / visibleCandles;
    
    // 2. Localiza o mouse ou usa o centro
    const mX = (mouseX !== undefined) ? mouseX : (canvas.width / 2);
    
    // 3. Calcula quantos candles existem entre o mouse e a borda direita ANTES do zoom
    const distToRight = canvas.width - rightMargin - mX;
    const candlesToRight = (distToRight - horizontalScroll) / cwBefore;

    // 4. Aplica o Zoom (Inverte o delta: Zoom In diminui visibleCandles)
    if (delta > 0) {
        visibleCandles = Math.max(1, visibleCandles * zoomSpeed);
    } else {
        visibleCandles = Math.min(200, visibleCandles / zoomSpeed);
    }

    // 5. Se o zoom mudou, ajusta o scroll para manter o ponto fixo
    if (oldVisible !== visibleCandles) {
        const cwAfter = (canvas.width - rightMargin) / visibleCandles;
        horizontalScroll = distToRight - (candlesToRight * cwAfter);
        
        needsAutoScale = true;
        needsHistoryRedraw = true;
        draw();
    }
}

// LÓGICA DE DESLIGAMENTO (SAÍDA)
const connStatus = document.getElementById('conn-status');
const shutdownOverlay = document.getElementById('shutdown-overlay');

if (connStatus) {
    connStatus.onclick = () => {
        showCustomConfirm("Deseja encerrar todo o sistema Zenith?", () => {
            // 1. Mostra o Overlay IMEDIATAMENTE
            if (shutdownOverlay) {
                shutdownOverlay.classList.add('active');
                const h2 = shutdownOverlay.querySelector('h2');
                const p = shutdownOverlay.querySelector('p');
                if (h2) h2.innerText = "SISTEMA ENCERRADO";
                if (p) p.innerText = "Todos os processos foram finalizados com sucesso.";
            }

            // 2. Envia o comando para o servidor morrer
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'SHUTDOWN' }));
            }
        });
    };
}

// BOTÃO DE LIMPEZA MANUAL (LIXEIRA)
const toolClear = document.getElementById('tool-clear');
if (toolClear) {
    toolClear.onclick = () => {
        showCustomConfirm("Deseja realmente LIMPAR os negócios? Isso vai zerar o histórico no navegador e no banco de dados, mas manterá suas cores e configurações.", () => {
            console.log("🗑️ LIMPANDO NEGÓCIOS (RESET DE HISTÓRICO)...");
        
        // MOSTRA A TELA DE CARREGAMENTO PARA O RESET
        const ov = document.getElementById('waiting-data');
        if (ov) {
            ov.style.display = 'flex';
            const textElem = ov.querySelector('.waiting-text');
            if (textElem) textElem.innerText = "LIMPANDO DADOS DA NUVEM, AGUARDE...";
        }

        // 1. Limpa Memória Local
        chartData = []; chartDataMap.clear(); processedTradeIds.clear(); rawTrades = [];

        // 2. Limpa Cache Visual
        historyCanvasCache.width = historyCanvasCache.width;
        needsHistoryRedraw = true;
        autoScale();
        draw();

        // 3. Limpa Banco de Dados Remoto (PostgreSQL)
        fetch('/api/trades/clear', { method: 'POST' })
            .then(() => {
                console.log("✅ Banco de dados limpo com sucesso.");
                // Avisa o motor Python para liberar a aba Historico
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'CLEAR_CHART' }));
                }
                
                if (ov) {
                    const textElem = ov.querySelector('.waiting-text');
                    if (textElem) textElem.innerText = "NUVEM VAZIA! RECARREGANDO...";
                }
                
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            })
            .catch(err => {
                console.error("Erro ao limpar banco:", err);
                if (ov) {
                    const textElem = ov.querySelector('.waiting-text');
                    if (textElem) textElem.innerText = "ERRO AO LIMPAR. RECARREGANDO...";
                }
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            });
        });
    };
}

// 11. UTILITÁRIOS DE CÁLCULO E DESENHO
function calculatePriceStep(range) {
    if (!range || range <= 0) return 0.25;
    
    // Alvo de aproximadamente 15 a 20 ticks na tela para maior detalhamento
    const targetTicks = 18; 
    let step = range / targetTicks;
    
    // Se o passo calculado for próximo de 0.25, força o 0.25
    if (step <= 0.40) return 0.25;
    if (step <= 0.80) return 0.50;
    if (step <= 1.50) return 1.00;

    const magnitude = Math.pow(10, Math.floor(Math.log10(step)));
    const res = step / magnitude;
    
    if (res > 5) step = 10 * magnitude;
    else if (res > 2) step = 5 * magnitude;
    else if (res > 1) step = 2 * magnitude;
    else step = magnitude;
    
    return Math.max(0.25, step);
}

function drawChevronTag(ctx, y, color, textColor, text, width) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    // Aponta para a ESQUERDA (em direção ao gráfico)
    ctx.moveTo(0, y);
    ctx.lineTo(8, y - 9);
    ctx.lineTo(width, y - 9);
    ctx.lineTo(width, y + 9);
    ctx.lineTo(8, y + 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = textColor;
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(text, width / 2 + 3, y + 4);
    ctx.restore();
}

// INICIALIZAÇÃO FINAL
loadSettingsFromServer().then(() => {
    updateMotorUI();
    connectMotor();
    resize();
    draw();
});

// 9. GESTÃO DE ATALHOS (v8.8.1 - SUPORTE A COMBINAÇÕES)
function checkShortcut(event, shortcutStr) {
    if (!shortcutStr) return false;
    const parts = shortcutStr.split('+');
    const triggerKey = parts.pop();
    const needsCtrl = parts.includes('Ctrl');
    const needsAlt = parts.includes('Alt');
    const needsShift = parts.includes('Shift');

    return event.code === triggerKey && 
           event.ctrlKey === needsCtrl && 
           event.altKey === needsAlt && 
           event.shiftKey === needsShift;
}

window.addEventListener('keydown', (e) => {
    if (isModalOpen() || document.activeElement.tagName === 'INPUT') return;

    if (checkShortcut(e, shortcuts.hand)) {
        e.preventDefault();
        activeTool = (activeTool === 'hand') ? 'none' : 'hand';
        updateToolUI();
    } else if (checkShortcut(e, shortcuts.cross)) {
        e.preventDefault();
        activeTool = (activeTool === 'cross') ? 'none' : 'cross';
        updateToolUI();
    } else if (checkShortcut(e, shortcuts.zoomIn)) {
        e.preventDefault();
        handleZoom(1);
        needsHistoryRedraw = true;
        draw();
    } else if (checkShortcut(e, shortcuts.zoomOut)) {
        e.preventDefault();
        handleZoom(-1);
        needsHistoryRedraw = true;
        draw();
    } else if (checkShortcut(e, shortcuts.reset)) {
        e.preventDefault();
        const btn = document.getElementById('tool-clear');
        if (btn) btn.click();
    } else if (checkShortcut(e, shortcuts.motor)) {
        e.preventDefault();
        const btn = document.getElementById('motor-toggle');
        if (btn) btn.click();
    } else if (checkShortcut(e, shortcuts.shutdown)) {
        e.preventDefault();
        if (confirm("Deseja realmente DESLIGAR o terminal?")) {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'SHUTDOWN' }));
            }
        }
    }
});

function initShortcutRecording() {
    const inputs = document.querySelectorAll('.shortcut-input');
    inputs.forEach(input => {
        const keyId = input.id.replace('shortcut-', '');
        const currentCombo = shortcuts[keyId === 'hand' ? 'hand' : 
                                       keyId === 'cross' ? 'cross' : 
                                       keyId === 'zoom-in' ? 'zoomIn' : 
                                       keyId === 'zoom-out' ? 'zoomOut' : 
                                       keyId === 'motor' ? 'motor' :
                                       keyId === 'shutdown' ? 'shutdown' : 'reset'];
        
        input.value = currentCombo ? currentCombo.replace(/Key|Digit/g, '').replace('Equal', '+').replace('Minus', '-') : "---";

        input.onclick = () => {
            if (input.classList.contains('recording')) return;
            input.classList.add('recording');
            input.value = "Pressione a combinação...";
            
            const captureKey = (e) => {
                // Não grava se for APENAS uma tecla modificadora sozinha
                if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
                
                e.preventDefault();
                e.stopPropagation();
                
                let combo = "";
                if (e.ctrlKey) combo += "Ctrl+";
                if (e.altKey) combo += "Alt+";
                if (e.shiftKey) combo += "Shift+";
                combo += e.code;
                
                const tool = input.id.replace('shortcut-', '');
                const settingsKey = tool === 'hand' ? 'hand' : tool === 'cross' ? 'cross' : 
                                    tool === 'zoom-in' ? 'zoomIn' : tool === 'zoom-out' ? 'zoomOut' : 
                                    tool === 'motor' ? 'motor' : tool === 'shutdown' ? 'shutdown' : 'reset';
                
                shortcuts[settingsKey] = combo;
                input.value = combo.replace(/Key|Digit/g, '').replace('Equal', '+').replace('Minus', '-');
                
                localStorage.setItem('zenith_shortcuts', JSON.stringify(shortcuts));
                saveSettingsToServer();
                input.classList.remove('recording');
                window.removeEventListener('keydown', captureKey, true);
            };
            window.addEventListener('keydown', captureKey, true);
        };
    });
}
