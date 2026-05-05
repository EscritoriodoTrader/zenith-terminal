const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const fs = require('fs');

// --- FUNÇÃO DE LIMPEZA ABSOLUTA ---
const cleanup = () => {
    console.log("\n🛑 [SISTEMA]: Iniciando encerramento total...");
    try {
        if (process.platform === "win32") {
            console.log("[SISTEMA]: Finalizando motor Python...");
            try {
                execSync('taskkill /F /IM python.exe', { stdio: 'ignore', timeout: 2000 });
            } catch (e) {}
        }
    } catch (err) {}
    
    console.log("[SISTEMA]: Adeus!");
    process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../grafico')));

// Motor Python (Global)
global.pythonProcess = null;

function startPythonScanner() {
    console.log("[SISTEMA]: Iniciando o motor de dados Python...");
    const scannerPath = path.join(__dirname, 'scanner.py');
    global.pythonProcess = spawn('python', [scannerPath], {
        stdio: 'inherit',
        shell: true
    });
}

// Rotas API
app.get('/api/trades/clear', (req, res) => { res.sendStatus(200); });
app.delete('/api/trades/clear', (req, res) => { res.sendStatus(200); });

// Servidor e WebSocket
const PORT = 10000;
const server = app.listen(PORT, () => {
    console.log(`\n🚀 ZENITH TERMINAL LIGADO: http://localhost:${PORT}`);
    startPythonScanner();
});

const wss = new WebSocket.Server({ server });

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const cmd = JSON.parse(message);
            if (cmd.type === 'SHUTDOWN') {
                cleanup();
            }
        } catch (e) {}
    });
});

// Middleware para receber dados do Python
app.post('/api/trades', (req, res) => {
    broadcast(req.body);
    res.sendStatus(200);
});
