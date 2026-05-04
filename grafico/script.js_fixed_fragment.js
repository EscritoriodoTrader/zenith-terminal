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
            targetCtx.fillStyle = footprintFontColor; 
            targetCtx.fillText(t.buy + t.sell, Math.round(x), Math.round(y + 4));
        }
    }
}
