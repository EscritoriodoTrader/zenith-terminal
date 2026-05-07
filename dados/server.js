const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const fs = require('fs');
const db = require('./database');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../grafico')));

// --- BANCO DE DADOS ---
db.initDatabase().catch(console.error);

// --- PERSISTÊNCIA CONFIGS ---
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
function getSettings() {
    try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) {}
    return {};
}
function saveSettings(s) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 4)); } catch (e) {} }

// --- MOTOR PYTHON ---
let scannerProcess = null;

function startPythonScanner() {
    if (process.platform !== "win32") return;
    console.log("[SISTEMA]: Realizando faxina de processos fantasmas...");
    try { 
        execSync('taskkill /F /IM python.exe /T', { stdio: 'ignore' }); 
        execSync('taskkill /F /IM py.exe /T', { stdio: 'ignore' });
    } catch (e) {}
    
    console.log("[SISTEMA]: Iniciando novo motor de dados limpo...");
    scannerProcess = spawn('python', [path.join(__dirname, 'scanner.py')], { stdio: 'inherit', shell: true });
    
    scannerProcess.on('exit', () => {
        console.log("[SISTEMA]: Motor Python encerrado.");
        scannerProcess = null;
        broadcast({ type: 'PYTHON_DISCONNECT' });
    });
}

// --- BROADCAST ---
function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

wss.on('connection', async (ws, req) => {
    const userAgent = req.headers['user-agent'] || 'Python-Scanner';
    const type = userAgent.includes('Mozilla') ? 'NAVEGADOR' : 'MOTOR PYTHON';
    console.log(`[WS]: ${type} conectado com sucesso.`);
    
    // Se for um navegador, o gráfico pedirá o histórico explicitamente via GET_HISTORY
    if (type === 'NAVEGADOR') {
        console.log(`[WS]: Terminal do Usuário conectado.`);
    }

    ws.on('message', async (message) => {
        try {
            const cmd = JSON.parse(message);
            if (cmd.type === 'SHUTDOWN') {
                console.log("[WS]: Comando de desligamento recebido. Encerrando sistemas...");
                
                // 1. Avisa todos os clientes (inclusive o Python) para fechar
                broadcast({ type: 'SHUTDOWN' });

                // 2. Tenta matar o processo Python via referência
                if (scannerProcess) {
                    try {
                        if (process.platform === "win32") {
                            execSync(`taskkill /F /T /PID ${scannerProcess.pid}`, { stdio: 'ignore' });
                        } else {
                            scannerProcess.kill('SIGTERM');
                        }
                    } catch (e) { console.error("Erro ao matar scannerProcess:", e.message); }
                }

                // 3. Pequeno delay para garantir o envio das mensagens antes de sair
                setTimeout(() => {
                    console.log("[SISTEMA]: Terminal encerrado com sucesso.");
                    process.exit(0);
                }, 1000);
            } else if (cmd.type === 'GET_HISTORY') {
                const history = await db.getTrades();
                ws.send(JSON.stringify({ type: 'HISTORY_DATA', data: history }));
            } else if (cmd.type === 'NEW_DATA' && cmd.data) {
                db.insertTrades(cmd.data).catch(() => {});
                broadcast(cmd);
            } else {
                broadcast(cmd);
            }
        } catch (e) {}
    });
});

// Rotas API
app.get('/api/settings', (req, res) => res.json(getSettings()));
app.post('/api/settings', (req, res) => { saveSettings(req.body); res.sendStatus(200); });

// Rota de Identidade para Auditoria de Versão
app.get('/api/identidade', (req, res) => res.send("VERSAO_7.1_AUDITADA"));

// Rota de Trades: Salva no banco e faz broadcast
app.post('/api/trades', async (req, res) => {
    const payload = req.body;
    if (payload.type === 'NEW_DATA' && payload.data) {
        try {
            console.log(`[DB]: Tentando salvar ${payload.data.length} trades no Supabase...`);
            await db.insertTrades(payload.data);
        } catch (err) {
            console.error("[DB ERROR]: Falha ao salvar no banco:", err.message);
        }
    }
    broadcast(payload);
    res.sendStatus(200);
});

app.all('/api/trades/clear', async (req, res) => {
    await db.clearDatabase();
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
startPythonScanner();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ZENITH ONLINE: Porta ${PORT}`);
});
