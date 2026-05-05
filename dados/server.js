const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const db = require('./database');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'grafico')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let isMotorRunning = false;

// Inicialização do Banco
db.initDatabase().catch(err => console.error("Erro DB:", err.message));

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
}

app.delete('/api/trades/clear', async (req, res) => {
    await db.clearDatabase();
    broadcast({ type: 'CLEAR_CHART' });
    res.sendStatus(200);
});

app.post('/api/trades', async (req, res) => {
    if (!isMotorRunning) return res.status(200).send("OFF");
    const { trades, last_price, variation } = req.body;
    broadcast({ type: 'MARKET_DATA', lastPrice: last_price, variation });
    if (trades && trades.length > 0) {
        broadcast({ type: 'NEW_TRADES', data: trades });
        db.insertTrades(trades).catch(e => {});
    }
    res.sendStatus(200);
});

wss.on('connection', async (ws) => {
    ws.send(JSON.stringify({ type: 'MOTOR_STATUS', running: isMotorRunning }));
    const history = await db.getTrades();
    if (history.length > 0) ws.send(JSON.stringify({ type: 'HISTORICAL_TRADES', trades: history }));

    ws.on('message', async (msg) => {
        try {
            const cmd = JSON.parse(msg);
            if (cmd.type === 'TOGGLE_MOTOR') {
                isMotorRunning = !isMotorRunning;
                broadcast({ type: 'MOTOR_STATUS', running: isMotorRunning });
                if (!isMotorRunning) await db.clearDatabase();
            }
            if (cmd.type === 'GET_HISTORY') {
                const h = await db.getTrades();
                ws.send(JSON.stringify({ type: 'HISTORICAL_TRADES', trades: h }));
            }
        } catch (e) {}
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`ZENITH ON: ${PORT}`));
