const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const db = require('./database');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'grafico'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let pythonProcess = null;
let isMotorRunning = false;

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

function getSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE));
    } catch (e) { console.error("Erro ao ler settings:", e); }
    return {};
}

function saveSettings(settings) {
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); }
    catch (e) { console.error("Erro ao salvar settings:", e); }
}

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

// Inicialização
db.initDatabase().catch(err => {
    console.error("Falha ao inicializar banco de dados:", err.message);
});

// ENDPOINTS API
app.get('/api/settings', (req, res) => res.json(getSettings()));
app.post('/api/settings', (req, res) => {
    saveSettings(req.body);
    res.sendStatus(200);
});

app.delete('/api/trades/clear', async (req, res) => {
    await db.clearDatabase();
    broadcast({ type: 'CLEAR_CHART' });
    res.sendStatus(200);
});

app.post('/api/trades', async (req, res) => {
    // Portão de Ferro: Se o motor estiver desligado, descarta os dados
    if (!isMotorRunning) {
        return res.status(200).send("Motor OFF - Dados descartados");
    }

    const { trades, last_price, variation } = req.body;

    broadcast({
        type: 'MARKET_DATA',
        lastPrice: last_price,
        variation: variation
    });

    if (trades && trades.length > 0) {
        broadcast({ type: 'NEW_TRADES', data: trades });
        db.insertTrades(trades).catch(err => console.error("Erro ao salvar trades:", err));
    }

    res.sendStatus(200);
});

// LÓGICA WEBSOCKET
wss.on('connection', async (ws) => {
    console.log('Cliente conectado ao WebSocket.');
    ws.send(JSON.stringify({ type: 'MOTOR_STATUS', running: isMotorRunning }));

    // Envio Otimizado de Histórico Inicial
    const history = await db.getTrades();
    if (history.length > 0) {
        console.log(`[WS]: Enviando lote inicial de ${history.length} trades.`);
        ws.send(JSON.stringify({ type: 'HISTORICAL_TRADES', trades: history }));
    }

    ws.on('message', async (message) => {
        try {
            const cmd = JSON.parse(message);
            if (cmd.type === 'TOGGLE_MOTOR') {
                isMotorRunning = !isMotorRunning;
                broadcast({ type: 'MOTOR_STATUS', running: isMotorRunning });
                
                // Se parou o motor, limpa o banco imediatamente (Segurança Extra)
                if (!isMotorRunning) {
                    console.log("🧹 Motor desligado pelo usuário. Limpando banco de dados...");
                    await db.clearDatabase();
                }
            }
            if (cmd.type === 'GET_HISTORY') {
                const h = await db.getTrades();
                ws.send(JSON.stringify({ type: 'HISTORICAL_TRADES', trades: h }));
            }
        } catch (e) { console.error("Erro no processamento WS:", e); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(` ZENITH TERMINAL SERVER - ATIVO NA PORTA ${PORT}`);
    console.log(`=========================================`);
});
