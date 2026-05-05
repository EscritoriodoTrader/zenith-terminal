/**
 * ZENITH TERMINAL - V3.53
 * RESTAURAÇÃO COMPLETA DE ESCALAS E PONTES DE DADOS
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
} catch(e) { 
    filters = [{ balance: 100, color: '#ffd700', opacity: 80 }]; 
}

let rawTrades = []; 
let processedTradeIds = new Set();
let tempSettings = {}; 
let motorStatus = getStorage('zenith_motor', 'off');
let socket;



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
        const resp = await fetch('/api/settings');
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

            // Aplicar CSS e UI
            document.documentElement.style.setProperty('--theme-bg', themeColor);
            const tfDisp = document.getElementById('tf-display');
            if (tfDisp) tfDisp.innerText = currentTimeframe.toUpperCase();
        }
    } catch (e) { console.warn("Erro ao carregar do servidor, usando local."); }
}

async function saveSettingsToServer() {
    const config = {
        chartBgColor, themeColor, posColor, negColor, currentTimeframe, filters,
        scaleFontSize, scaleFontColor, footprintBgColor, footprintFontColor,
        posOutlineColor, negOutlineColor, lastPriceBgColor, lastPriceLineColor
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

    if (minH !== Infinity) { 
        const r = maxH - minH, p = Math.max(0.1, r * 0.15); 
        const targetMax = maxH + p, targetMin = minH - p;
        
        // AUTO-SCALE PREGUIÇOSO: Só ajusta se a mudança for maior que 1.0 ou se o preço sair da tela
        const diff = Math.abs(targetMax - priceMax) + Math.abs(targetMin - priceMin);
        const lastP = chartData[0] ? chartData[0].close : (priceMax + priceMin)/2;
        
        if (diff > 1.0 || lastP > priceMax || lastP < priceMin) {
            priceMax = targetMax; priceMin = targetMin;
            needsHistoryRedraw = true;
            needsScaleRedraw = true;
        }
    }
}

// 6. RENDERIZAÇÃO DE ESCALAS
function drawChevronTag(ctx, y, color, textColor, text, width) {
    const h = 20; ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(10, y - h/2); ctx.lineTo(width, y - h/2); ctx.lineTo(width, y + h/2); ctx.lineTo(10, y + h/2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = textColor; ctx.font = "bold 11px Arial"; ctx.textAlign = "right"; ctx.fillText(text, width - 5, y + 4);
}

function drawScales(range) {
    const dpr = window.devicePixelRatio || 1;
    const sW = scaleCanvas.width / dpr;
    const sH = scaleCanvas.height / dpr;
    const tW = timeCanvas.width / dpr;

    if (needsScaleRedraw) {
        // Redesenhar réguas estáticas
        staticScaleCtx.clearRect(0, 0, staticScaleCache.width, staticScaleCache.height);
        staticScaleCtx.save(); staticScaleCtx.scale(dpr, dpr);
        staticScaleCtx.fillStyle = chartBgColor; staticScaleCtx.fillRect(0, 0, sW, sH);
        
        const niceSteps = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
        const rawStep = range / (sH / 45);
        const step = niceSteps.find(s => s >= rawStep) || niceSteps[niceSteps.length - 1];
        
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
                    const label = `${String(c.timestamp.getHours()).padStart(2,'0')}:${String(c.timestamp.getMinutes()).padStart(2,'0')}`;
                    staticTimeCtx.fillText(label, x, 15);
                }
            }
        }

        if (chartData[0]) {
            staticTimeCtx.fillStyle = scaleFontColor; staticTimeCtx.font = `bold ${scaleFontSize}px Arial`;
            const dateStr = `${String(chartData[0].timestamp.getDate()).padStart(2,'0')}/${String(chartData[0].timestamp.getMonth()+1).padStart(2,'0')}`;
            staticTimeCtx.fillText(dateStr, tW / 2, 30);
        }
        staticTimeCtx.restore();
        needsScaleRedraw = false;
    }

    // Renderizar caches no canvas visível
    scaleCtx.clearRect(0, 0, sW, sH);
    scaleCtx.drawImage(staticScaleCache, 0, 0, sW, sH);
    timeCtx.clearRect(0, 0, tW, 35);
    timeCtx.drawImage(staticTimeCache, 0, 0, tW, 35);

    // Camada Dinâmica (Preço Atual e Mira)
    if (chartData[0] && hasRealData) {
        const lastP = chartData[0].close, y = sH - ((lastP - priceMin) / range) * sH;
        drawChevronTag(scaleCtx, y, lastPriceBgColor, "#000000", priceFormatter.format(lastP), sW);
    }

    if (activeTool === 'cross') {
        const y = mousePos.y, p = priceMax - (y / (canvas.height / dpr)) * range;
        drawChevronTag(scaleCtx, y, "#ffffff", "#000000", priceFormatter.format(p), sW);
        
        const cW = (canvas.width / dpr - rightMargin) / visibleCandles;
        const candleIdx = Math.round(((canvas.width / dpr - rightMargin) - (mousePos.x - horizontalScroll)) / cW);
        if (chartData[candleIdx]) {
            const hLabel = `${String(chartData[candleIdx].timestamp.getHours()).padStart(2,'0')}:${String(chartData[candleIdx].timestamp.getMinutes()).padStart(2,'0')}`;
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
        const range = Math.max(0.0001, priceMax - priceMin);
        const dpr = window.devicePixelRatio || 1;
        
        // Processar Escala se solicitado
        if (needsAutoScale) {
            autoScale();
            needsAutoScale = false;
        }

        const cW = (canvas.width - rightMargin) / visibleCandles;
        const tickH = (0.25 / range) * canvas.height;

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
            
            // Mensagem de Status
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.font = "20px Arial";
            ctx.textAlign = "center";
            
            let statusText = "Aguardando dados reais do Excel...";
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                statusText = "❌ DESCONECTADO DO SERVIDOR (Tentando reconectar...)";
                ctx.fillStyle = "#f23645";
            } else if (motorStatus === 'off') {
                statusText = "⏸️ MOTOR DESLIGADO. Clique no botão de Power para iniciar.";
                ctx.fillStyle = "#ff9800";
            }

            ctx.fillText(statusText, (canvas.width/dpr - rightMargin)/2, (canvas.height/dpr)/2);
            
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

        // 5. LINHA DE PREÇO ATUAL (Sincronia Total com C2)
        const lastP = (externalLastPrice > 0) ? externalLastPrice : currentCandle.close;
        const yL = canvas.height / dpr - ((lastP - priceMin) / range) * (canvas.height / dpr);
        
        if (yL >= 0 && yL <= canvas.height / dpr) {
            // A linha nasce na vela e vai até o fim da tela na direita
            const startX = (canvas.width / dpr - rightMargin) + horizontalScroll + (cW * 0.5);
            
            ctx.save();
            ctx.strokeStyle = lastPriceLineColor; 
            ctx.lineWidth = 1; 
            ctx.setLineDash([]); 
            ctx.beginPath();
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
        ctx.setLineDash([5,5]); 
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

        if (Math.abs(mousePos.x - x) < cW/2 && mousePos.x < (canvas.width/dpr - rightMargin) && mousePos.y >= yH && mousePos.y <= yL) {
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
    const x = (canvas.width / (window.devicePixelRatio || 1) - rightMargin) - (i * cW) + horizontalScroll;
    const yO = canvas.height / (window.devicePixelRatio || 1) - ((c.open - priceMin) / range) * (canvas.height / (window.devicePixelRatio || 1));
    const yC = canvas.height / (window.devicePixelRatio || 1) - ((c.close - priceMin) / range) * (canvas.height / (window.devicePixelRatio || 1));
    const uW = cW * 0.90, bW = uW * 0.55, mBW = uW * 0.25;

    targetCtx.beginPath();
    targetCtx.strokeStyle = c.close >= c.open ? posOutlineColor : negOutlineColor; targetCtx.lineWidth = 1.5; 
    targetCtx.strokeRect(x - uW/2, Math.min(yO, yC), uW, Math.max(1, Math.abs(yC - yO)));
    targetCtx.stroke();

    if (!c.maxV) {
        let mv = 1; Object.values(c.ticks).forEach(t => { if (t.buy + t.sell > mv) mv = t.buy + t.sell; });
        c.maxV = mv;
    }

    targetCtx.font = "bold 12px Arial";
    targetCtx.textAlign = "center";

    for (let pS in c.ticks) {
        const pNum = parseFloat(pS);
        if (pNum < priceMin - 0.5 || pNum > priceMax + 0.5) continue;

        const t = c.ticks[pS], y = canvas.height / (window.devicePixelRatio || 1) - ((pNum - priceMin) / range) * (canvas.height / (window.devicePixelRatio || 1));
        const s = t.buy - t.sell;

        filters.forEach(f => { 
            if (Math.abs(s) >= f.balance) { 
                targetCtx.fillStyle = hexToRgba(f.color, f.opacity); 
                targetCtx.fillRect(x - bW/2 + 2, y - tickH/4, bW/4 - 2, tickH/2); 
            } 
        });

        const boxH = Math.max(1, Math.floor(tickH) - 2);
        const startY = Math.round(y - tickH/2) + 1;
        targetCtx.fillStyle = footprintBgColor; 
        targetCtx.fillRect(Math.round(x - bW/4), startY, Math.round(bW/2), boxH);

        const isPos = pNum >= c.open;
        targetCtx.fillStyle = isPos ? hexToRgba(posColor, 100) : hexToRgba(negColor, 100); 
        targetCtx.fillRect(Math.round(x + bW/4), Math.round(y - tickH/4), Math.round(((t.buy+t.sell)/c.maxV)*mBW), Math.round(tickH/2));

        if (tickH > 8 && cW > 30) {
            // Saldo (Delta) à esquerda
            targetCtx.fillStyle = isPos ? posColor : negColor; 
            targetCtx.textAlign = "right"; 
            targetCtx.fillText(s, Math.round(x - (bW/4) - 6), Math.round(y + 4));
            
            // Volume Total ao centro
            targetCtx.fillStyle = footprintFontColor; 
            targetCtx.textAlign = "center"; 
            targetCtx.fillText(t.buy + t.sell, Math.round(x), Math.round(y + 4));
        }
    }
}

// 8. INTERATIVIDADE E UI
canvas.onwheel = (e) => { e.preventDefault(); visibleCandles *= (e.deltaY > 0 ? 1.1 : 0.9); visibleCandles = Math.min(100, Math.max(1, visibleCandles)); needsHistoryRedraw = true; needsScaleRedraw = true; }, { passive: false };
canvas.onmousemove = (e) => { const rect = canvas.getBoundingClientRect(); mousePos.x = e.clientX - rect.left; mousePos.y = e.clientY - rect.top; if (isDrag) { const dX = e.clientX - lX, dY = e.clientY - lY; lX = e.clientX; lY = e.clientY; horizontalScroll += dX; if (Math.abs(dY) > 2) isAutoScale = false; const r = priceMax - priceMin; priceMax += (dY/canvas.height)*r; priceMin += (dY/canvas.height)*r; needsHistoryRedraw = true; needsScaleRedraw = true; } };
canvas.onmousedown = (e) => { if (isModalOpen()) return; if (activeTool === 'hand') { isDrag = true; lX = e.clientX; lY = e.clientY; canvas.style.cursor = 'grabbing'; } };
window.onmouseup = () => { isDrag = false; canvas.style.cursor = activeTool === 'hand' ? 'grab' : (activeTool === 'cross' ? 'crosshair' : 'default'); };
scaleCanvas.onmousedown = (e) => { if (isModalOpen()) return; isDragS = true; lSY = e.clientY; };
window.addEventListener('mousemove', (e) => { 
    if (isDragS) { 
        isAutoScale = false; const dY = lSY - e.clientY; lSY = e.clientY; const r = priceMax - priceMin, f = dY * (r / scaleCanvas.height); priceMax += f; priceMin -= f; needsHistoryRedraw = true; needsScaleRedraw = true;
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
    };
});


document.getElementById('tool-cross').onclick = () => { activeTool = activeTool === 'cross' ? 'none' : 'cross'; canvas.style.cursor = activeTool === 'cross' ? 'crosshair' : 'default'; updateToolUI(); };
document.getElementById('tool-hand').onclick = () => { activeTool = activeTool === 'hand' ? 'none' : 'hand'; canvas.style.cursor = activeTool === 'hand' ? 'grab' : 'default'; updateToolUI(); };
document.getElementById('tool-search').onclick = () => { searchOverlay.classList.add('active'); searchInput.value = ''; searchInput.focus(); };
document.getElementById('tool-zoom-in').onclick = () => { visibleCandles *= 0.8; if (visibleCandles < 1) visibleCandles = 1; autoScale(); };
document.getElementById('tool-zoom-out').onclick = () => { visibleCandles *= 1.2; if (visibleCandles > 100) visibleCandles = 100; autoScale(); };
document.getElementById('conn-status').onclick = function() { this.classList.toggle('on'); this.classList.toggle('off'); };
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

document.getElementById('input-chart-bg').oninput = function() { tempSettings.chartBgColor = this.value; updatePickerUI(this); };
document.getElementById('input-theme-bg').oninput = function() { tempSettings.themeColor = this.value; updatePickerUI(this); };
document.getElementById('input-pos-color').oninput = function() { tempSettings.posColor = this.value; updatePickerUI(this); };

document.getElementById('input-neg-color').oninput = function() { tempSettings.negColor = this.value; updatePickerUI(this); };
document.getElementById('input-pos-outline').oninput = function() { tempSettings.posOutlineColor = this.value; updatePickerUI(this); };
document.getElementById('input-neg-outline').oninput = function() { tempSettings.negOutlineColor = this.value; updatePickerUI(this); };
document.getElementById('input-font-size').oninput = function() { tempSettings.scaleFontSize = parseInt(this.value); };
document.getElementById('input-font-color').oninput = function() { tempSettings.scaleFontColor = this.value; updatePickerUI(this); };
document.getElementById('input-footprint-bg').oninput = function() { tempSettings.footprintBgColor = this.value; updatePickerUI(this); };
document.getElementById('input-footprint-font-color').oninput = function() { tempSettings.footprintFontColor = this.value; updatePickerUI(this); };
document.getElementById('input-last-price-bg').oninput = function() { tempSettings.lastPriceBgColor = this.value; updatePickerUI(this); };
document.getElementById('input-last-price-line').oninput = function() { tempSettings.lastPriceLineColor = this.value; updatePickerUI(this); };




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
                document.getElementById('tf-display').innerText = currentTimeframe.toUpperCase();
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
    // Atalho: Digitar para pesquisar
    if (!isModalOpen() && /^[a-z0-9]$/i.test(e.key)) {
        searchOverlay.classList.add('active');
        searchInput.value = e.key.toUpperCase();
        searchInput.focus();
        e.preventDefault();
    }
});
// LÓGICA DO MOTOR
function connectMotor() {

    if (socket) socket.close();
    
    // Força WSS na nuvem (Render) e WS no local
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const protocol = isLocal ? 'ws:' : 'wss:';
    const host = window.location.host; 
    
    socket = new WebSocket(`${protocol}//${host}`);
    
    const statusIcon = document.getElementById('conn-status');
    if (statusIcon) statusIcon.style.color = '#ff9800'; 
    
    socket.onopen = () => { 
        console.log("ZENITH CLOUD: Conectado via WSS Seguro"); 
        updateMotorUI(); 
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
                    console.log(`🛑 MOTOR OFF: Limpando ${chartData.length} candles e ${rawTrades.length} trades brutos.`);
                    // Limpeza Local (RAM)
                    chartData = []; chartDataMap.clear(); processedTradeIds.clear(); rawTrades = [];
                    // Limpeza Visual (Cache de Imagem)
                    historyCanvasCache.width = historyCanvasCache.width; 
                    needsHistoryRedraw = true;
                    needsScaleRedraw = true;
                    autoScale();
                    draw();
                    
                    // Limpeza Remota (Banco de Dados)
                    fetch('/api/trades/clear', { method: 'DELETE' })
                        .then(() => console.log("✅ Banco de dados remoto limpo."))
                        .catch(err => console.error("❌ Erro ao limpar banco:", err));
                }
                
                if (wasOff && msg.running && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'GET_HISTORY' }));
                }
            }

            if (msg.type === 'MARKET_DATA') {
                const varElem = document.getElementById('variation');
                if (varElem) {
                    varElem.innerText = (msg.variation || 0).toFixed(2) + '%';
                    varElem.style.color = msg.variation >= 0 ? '#089981' : '#f23645';
                    varElem.style.opacity = "1";
                }
                externalLastPrice = msg.lastPrice;
                if (chartData.length > 0) {
                    const cur = chartData[0];
                    cur.close = externalLastPrice;
                    if (externalLastPrice > cur.high) cur.high = externalLastPrice;
                    if (externalLastPrice < cur.low) cur.low = externalLastPrice;
                }
            }

            if (msg.type === 'HISTORICAL_TRADES' || msg.type === 'NEW_TRADES' || msg.type === 'NEW_TRADE') {
                const list = msg.trades || msg.data || (msg.id ? [msg] : null);
                if (list && list.length > 0) processTrades(list);
            }
            
            if (msg.type === 'CLEAR_CHART') {
                chartData = []; chartDataMap.clear(); processedTradeIds.clear(); rawTrades = [];
                needsHistoryRedraw = true; draw();
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
    console.log("%c >>> 📥 DADOS CHEGANDO NO NAVEGADOR! <<< ", "background: #00ff00; color: #000; font-size: 16px; font-weight: bold;");
    console.log(`[ZENITH]: Recebidos ${trades.length} trades.`);
    needsHistoryRedraw = true; // Força o redesenho completo
    
    let tfMin = parseInt(currentTimeframe) || 5;
    if (currentTimeframe.toUpperCase().includes('H')) tfMin *= 60;
    if (currentTimeframe.toUpperCase().includes('D')) tfMin *= 1440;
    const tfMs = tfMin * 60 * 1000;
    let addedNewCandle = false;

    trades.forEach(t => {
        if (!t.id || processedTradeIds.has(t.id)) return;
        processedTradeIds.add(t.id);
        rawTrades.push(t); 
        
        // Limita o cache para evitar consumo excessivo de RAM (Mantém os últimos 15 mil)
        if (rawTrades.length > 15000) {
            const removed = rawTrades.shift();
            processedTradeIds.delete(removed.id);
        }

        const candleTime = Math.floor(t.timestamp / tfMs) * tfMs;
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
    });

    if (addedNewCandle) {
        chartData.sort((a, b) => b.timestamp - a.timestamp);
        needsHistoryRedraw = true;
        needsScaleRedraw = true;
    }
}

// Função de RE-AGREGAÇÃO ULTRA-RÁPIDA (Local)
function reaggregateChart() {
    console.log("🚀 Re-agregando gráfico para", currentTimeframe);
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
        console.log("🎨 UI: Botão Motor -> VERDE");
    } else {
        btn.classList.add('off');
        btn.classList.remove('on');
        console.log("🎨 UI: Botão Motor -> VERMELHO");
    }

    // Ícone de Baixo: Status do Terminal (Conexão com Servidor)
    // Se motorStatus estiver 'on' em localStorage, tentamos manter verde ou laranja
    if (socket && socket.readyState === WebSocket.OPEN) {
        if (statusIcon) statusIcon.style.color = '#089981'; // Verde: Terminal Conectado
    } else if (motorStatus === 'on' || (socket && socket.readyState === WebSocket.CONNECTING)) {
        if (statusIcon) statusIcon.style.color = '#ff9800'; // Laranja: Reconectando...
    } else {
        if (statusIcon) statusIcon.style.color = 'rgba(255,255,255,0.2)'; // Cinza: Terminal Off
    }
}



// LÓGICA DE CLIQUE GLOBAL (À PROVA DE FALHAS)
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#motor-toggle');
    if (btn) {
        console.log("⚡ CLIQUE GLOBAL DETECTADO NO MOTOR!");
        const newStatus = (motorStatus === 'on') ? 'off' : 'on';
        
        motorStatus = newStatus;
        updateMotorUI();
        setStorage('zenith_motor', motorStatus);
        
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'TOGGLE_MOTOR' }));
        } else if (newStatus === 'on') {
            connectMotor();
        }
    }
});

// LÓGICA DE DESLIGAMENTO (SAÍDA)
const connStatus = document.getElementById('conn-status');
const shutdownOverlay = document.getElementById('shutdown-overlay');

if (connStatus) {
    connStatus.onclick = () => {
        shutdownOverlay.classList.add('active');
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'SHUTDOWN' }));
        }
        setTimeout(() => { window.close(); }, 1500);
    };
}

// BOTÃO DE LIMPEZA MANUAL (LIXEIRA)
const toolClear = document.getElementById('tool-clear');
if (toolClear) {
    toolClear.onclick = () => {
        if (!confirm("Deseja realmente LIMPAR tudo? Isso vai resetar o navegador e o banco de dados.")) return;
        
        console.log("🗑️ LIMPANDO TUDO (HARD RESET)...");
        // 1. Limpa Memória Local
        chartData = []; chartDataMap.clear(); processedTradeIds.clear(); rawTrades = [];
        
        // 2. Limpa Cache Visual
        historyCanvasCache.width = historyCanvasCache.width;
        needsHistoryRedraw = true;
        autoScale();
        draw();
        
        // 3. Limpa LocalStorage (Zera as configurações também para garantir)
        localStorage.clear();
        
        // 4. Limpa Banco de Dados Remoto
        fetch('/api/trades/clear', { method: 'DELETE' })
            .then(() => {
                alert("SISTEMA RESETADO! A página será recarregada para garantir limpeza total.");
                window.location.reload();
            })
            .catch(err => console.error("Erro ao limpar:", err));
    };
}

