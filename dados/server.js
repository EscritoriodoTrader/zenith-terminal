const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// --- FUNÇÃO DE LIMPEZA ABSOLUTA ---
const cleanup = () => {
    console.log("\n🛑 [SISTEMA]: Iniciando encerramento total...");
    try {
        if (process.platform === "win32") {
            const { execSync } = require('child_process');
            console.log("[SISTEMA]: Finalizando motor Python...");
            // Executa com timeout de 2s para não travar o Node
            try {
                execSync('taskkill /F /IM python.exe', { stdio: 'ignore', timeout: 2000 });
            } catch (e) {}
        } else {
            if (global.pythonProcess) global.pythonProcess.kill();
        }
    } catch (err) {
        console.log("[SISTEMA]: Erro na limpeza, mas prosseguindo com o fechamento.");
    }
    
    console.log("[SISTEMA]: Adeus!");
    setTimeout(() => { process.exit(0); }, 500);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

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
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === 2) return; // 2 = CLOSING
        if (client.readyState === 1) { // 1 = OPEN
            client.send(message);
        }
    });
}

app.get('/api/motor-status', (req, res) => res.json({ running: isMotorRunning }));

app.delete('/api/trades/clear', async (req, res) => {
    await db.clearDatabase();
    broadcast({ type: 'CLEAR_CHART' });
    res.sendStatus(200);
});

app.post('/api/trades', (req, res) => {
    const { trades, last_price, asset, variation } = req.body;
    
    // Responde IMEDIATAMENTE
    res.status(200).send("OK");

    if (isMotorRunning) {
        broadcast({ 
            type: 'NEW_TRADES', 
            data: trades || [], 
            asset: asset, 
            variation: variation, 
            lastPrice: last_price 
        });
    }
});

wss.on('connection', async (ws) => {
    ws.send(JSON.stringify({ type: 'MOTOR_STATUS', running: isMotorRunning }));
    const history = await db.getTrades();
    if (history.length > 0) ws.send(JSON.stringify({ type: 'HISTORICAL_TRADES', trades: history }));

    ws.on('message', async (msg) => {
        try {
            const cmd = JSON.parse(msg);
            
            // RECEBIMENTO DE TRADES VIA WEBSOCKET (ALTA PERFORMANCE)
            if (cmd.type === 'NEW_TRADES' && cmd.data) {
                broadcast({ 
                    type: 'NEW_TRADES', 
                    data: cmd.data, 
                    asset: cmd.asset, 
                    variation: cmd.variation,
                    lastPrice: cmd.last_price 
                });
            }

            if (cmd.type === 'TOGGLE_MOTOR') {
                isMotorRunning = !isMotorRunning;
                broadcast({ type: 'MOTOR_STATUS', running: isMotorRunning });
                if (!isMotorRunning) await db.clearDatabase();
            }
            if (cmd.type === 'GET_HISTORY') {
                const h = await db.getTrades();
                ws.send(JSON.stringify({ type: 'HISTORICAL_TRADES', trades: h }));
            }

            // COMANDO DE DESLIGAMENTO TOTAL (REMOTO)
            if (cmd.type === 'SHUTDOWN') {
                cleanup(); 
            }
        } catch (e) {}
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`\n🚀 ZENITH TERMINAL LIGADO: http://localhost:${PORT}`);
    startPythonScanner();
});

// ==========================================
// INTEGRAÇÃO AUTOMÁTICA COM O PYTHON
// ==========================================
const { spawn } = require('child_process');
global.pythonProcess = null;

function startPythonScanner() {
    console.log("[SISTEMA]: Iniciando o motor de dados Python...");
    
    // Caminho absoluto para o scanner na mesma pasta do servidor
    const scannerPath = path.join(__dirname, 'scanner.py');
    
    // Tenta rodar com 'python' (Windows padrão) ou 'python3'
    global.pythonProcess = spawn('python', [scannerPath], {
        stdio: 'inherit', // Faz os logs do Python aparecerem no terminal do Node
        shell: true
    });

    global.pythonProcess.on('error', (err) => {
        console.error("❌ ERRO AO INICIAR PYTHON:", err.message);
        console.log("Dica: Verifique se o Python está instalado e no PATH do sistema.");
    });

    global.pythonProcess.on('close', (code) => {
        if (code !== 0 && code !== null) {
            console.log(`[AVISO]: O motor Python parou inesperadamente (Código ${code}). Reiniciando em 5s...`);
            setTimeout(startPythonScanner, 5000);
        }
    });
    });
}
