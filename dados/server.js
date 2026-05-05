const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../grafico')));

// --- FUNÇÃO DE LIMPEZA ---
function shutdown() {
    console.log("\n🛑 [SHUTDOWN]: Encerrando processos...");
    try {
        if (process.platform === "win32") {
            // Mata o Python sem piedade
            execSync('taskkill /F /IM python.exe', { stdio: 'ignore' });
        }
    } catch (e) {}
    console.log("[SISTEMA]: Saindo.");
    process.exit(0);
}

// Motor Python
global.pythonProcess = null;
function startPythonScanner() {
    const scannerPath = path.join(__dirname, 'scanner.py');
    global.pythonProcess = spawn('python', [scannerPath], { stdio: 'inherit', shell: true });
}

// Servidor
const server = app.listen(10000, () => {
    console.log(`\n🚀 ZENITH TERMINAL: http://localhost:10000`);
    startPythonScanner();
});

const wss = new WebSocket.Server({ server });

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
}

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const cmd = JSON.parse(message);
            if (cmd.type === 'SHUTDOWN') {
                // Dá 200ms para a mensagem sair e então mata tudo
                setTimeout(shutdown, 200);
            }
        } catch (e) {}
    });
});

app.post('/api/trades', (req, res) => {
    broadcast(req.body);
    res.sendStatus(200);
});

// Rotas de limpeza para compatibilidade
app.all('/api/trades/clear', (req, res) => res.sendStatus(200));

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
