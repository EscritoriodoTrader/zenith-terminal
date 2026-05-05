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

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
function getSettings() {
    try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE)); } catch (e) {}
    return {};
}
function saveSettings(s) {
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); } catch (e) {}
}

// Inicialização do Banco com log de erro detalhado
console.log("[INIT]: Iniciando servidor...");
db.initDatabase()
    .then(() => console.log("[INIT]: Banco de dados pronto."))
    .catch(err => console.error("❌ ERRO CRÍTICO NO BANCO:", err.message));

app.get('/api/settings', (req, res) => res.json(getSettings()));
app.post('/api/settings', (req, res) => { saveSettings(req.body); res.sendStatus(200); });

process.on('uncaughtException', (err) => {
    console.error('❌ ERRO NÃO TRATADO:', err);
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
}

app.get('/api/motor-status', (req, res) => res.json({ running: isMotorRunning }));

app.delete('/api/trades/clear', async (req, res) => {
    await db.clearDatabase();
    broadcast({ type: 'CLEAR_CHART' });
    res.sendStatus(200);
});

app.post('/api/trades', async (req, res) => {
    const { trades, last_price } = req.body;
    if (trades && trades.length > 0) {
        console.log(`>>> RECEBIDOS ${trades.length} TRADES DO PYTHON <<<`);
        broadcast({ type: 'NEW_TRADES', data: trades }); // Força o envio para o gráfico
    }
    
    if (!isMotorRunning) return res.status(200).send("OFF");
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
