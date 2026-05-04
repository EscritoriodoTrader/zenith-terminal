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

// Configurações do gráfico persistidas no servidor
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

function loadSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4));
}

/**
 * Broadcast de mensagens para todos os clientes conectados
 */
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ENDPOINTS API
app.get('/api/settings', (req, res) => res.json(loadSettings()));
app.post('/api/settings', (req, res) => {
    saveSettings(req.body);
    res.sendStatus(200);
});

// Recebimento de trades do scanner.py
app.post('/api/trades', async (req, res) => {
    const { trades, last_price, variation } = req.body;

    // 1. Enviar dados de mercado (Preço e Variação)
    broadcast({
        type: 'MARKET_DATA',
        lastPrice: last_price,
        variation: variation
    });

    // 2. Processar Novos Trades
    if (trades && trades.length > 0) {
        // Enviar para o gráfico imediatamente
        broadcast({ type: 'NEW_TRADES', data: trades });

        // Salvar no banco de dados em segundo plano
        db.insertTrades(trades).catch(err => console.error("Erro ao salvar trades:", err));
    }

    res.sendStatus(200);
});

// LÓGICA WEBSOCKET
wss.on('connection', async (ws) => {
    console.log('Cliente conectado ao WebSocket.');

    // Enviar status inicial
    ws.send(JSON.stringify({ type: 'MOTOR_STATUS', running: isMotorRunning }));

    // Se o motor estiver rodando, enviar histórico imediatamente
    if (isMotorRunning) {
        const history = await db.getTrades();
        ws.send(JSON.stringify({ type: 'HISTORY', data: history }));
    }

    ws.on('message', async (message) => {
        try {
            const cmd = JSON.parse(message);

            if (cmd.type === 'TOGGLE_MOTOR') {
                if (!isMotorRunning) {
                    // LIGAR MOTOR
                    console.log("Iniciando Motor...");
                    await db.initDatabase();
                    // Opcional: Limpar banco ao ligar se o usuário preferir começar do zero
                    // await db.clearDatabase(); 

                    pythonProcess = spawn('python', [path.join(__dirname, 'scanner.py')]);
                    
                    pythonProcess.stdout.on('data', (data) => console.log(`[PYTHON]: ${data}`));
                    pythonProcess.stderr.on('data', (data) => console.error(`[PYTHON ERROR]: ${data}`));
                    
                    isMotorRunning = true;
                } else {
                    // DESLIGAR MOTOR
                    console.log("Desligando Motor...");
                    if (pythonProcess) {
                        pythonProcess.kill();
                        pythonProcess = null;
                    }
                    isMotorRunning = false;
                }
                broadcast({ type: 'MOTOR_STATUS', running: isMotorRunning });
            }

            if (cmd.type === 'GET_HISTORY') {
                const history = await db.getTrades();
                ws.send(JSON.stringify({ type: 'HISTORY', data: history }));
            }

            if (cmd.type === 'SHUTDOWN') {
                console.log("Encerrando sistema...");
                if (pythonProcess) pythonProcess.kill();
                process.exit(0);
            }
        } catch (e) {
            console.error("Erro no processamento de mensagem WS:", e);
        }
    });
});

// INICIALIZAÇÃO
const PORT = 3000;
server.listen(PORT, async () => {
    console.log(`=========================================`);
    console.log(`ZENITH TERMINAL SERVER - ATIVO NA PORTA ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
    console.log(`=========================================`);
    
    try {
        await db.initDatabase();
        console.log("Banco de dados inicializado.");
    } catch (e) {
        console.error("Falha ao inicializar banco de dados:", e.message);
    }
});
