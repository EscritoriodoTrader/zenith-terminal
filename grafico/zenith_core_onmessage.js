    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'MOTOR_STATUS') {
                const wasOff = motorStatus === 'off';
                motorStatus = msg.running ? 'on' : 'off';
                setStorage('zenith_motor', motorStatus);
                updateMotorUI();
                if (!msg.running) {
                    chartData = []; chartDataMap.clear(); processedTradeIds.clear(); rawTrades = [];
                    needsHistoryRedraw = true;
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
