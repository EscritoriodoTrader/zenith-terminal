const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const fs = require('fs');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../grafico')));

// --- PERSISTÊNCIA ---
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
function getSettings() {
    try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) {}
    return {};
}
function saveSettings(s) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 4)); } catch (e) {} }

// --- MOTOR PYTHON ---
function startPythonScanner() {
    if (process.platform !== "win32") return;
    console.log("[SISTEMA]: Executando limpeza profunda de processos...");
    try { 
        // Mata todos os Pythons e instâncias órfãs de Node (exceto esta)
        execSync('taskkill /F /IM python.exe /T', { stdio: 'ignore' }); 
        execSync('taskkill /F /IM py.exe /T', { stdio: 'ignore' });
        // Tenta liberar a porta 10000 se houver algo travado (comando potente do Windows)
        execSync('for /f "tokens=5" %a in (\'netstat -aon ^| findstr :10000\') do taskkill /f /pid %a', { stdio: 'ignore', shell: true });
    } catch (e) {}
    
    console.log("[SISTEMA]: Iniciando motor de dados limpo...");
    spawn('python', [path.join(__dirname, 'scanner.py')], { stdio: 'inherit', shell: true });
}

// --- BROADCAST ---
function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

wss.on('connection', (ws, req) => {
    const userAgent = req.headers['user-agent'] || 'Python-Scanner';
    const type = userAgent.includes('Mozilla') ? 'NAVEGADOR' : 'MOTOR PYTHON';
    console.log(`[WS]: ${type} conectado com sucesso.`);
    
    ws.on('message', (message) => {
        try {
            const cmd = JSON.parse(message);
            if (cmd.type === 'SHUTDOWN') {
                console.log("[WS]: Comando de desligamento recebido.");
                try { if (process.platform === "win32") execSync('taskkill /F /IM python.exe', { stdio: 'ignore' }); } catch (e) {}
                process.exit(0);
            } else {
                broadcast(cmd);
            }
        } catch (e) {}
    });
});

// Rotas API
app.get('/api/settings', (req, res) => res.json(getSettings()));
app.post('/api/settings', (req, res) => { saveSettings(req.body); res.sendStatus(200); });
app.post('/api/trades', (req, res) => { broadcast(req.body); res.sendStatus(200); });
app.all('/api/trades/clear', (req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 10000;
startPythonScanner(); // Limpa a porta e o PC antes de ligar

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ZENITH ONLINE: Porta ${PORT}`);
});
