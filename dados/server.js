const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { spawn, execSync } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const fs = require('fs');
const db = require('./database');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Memória dos ativos detectados pelo Python
const activeAssets = new Set();

const staticPath = path.join(__dirname, '../Top');
console.log(`[SISTEMA]: Servindo arquivos estáticos de: ${staticPath}`);

const coreFile = path.join(staticPath, 'assets/app-hLqRDvZo.js');
if (fs.existsSync(coreFile)) {
    console.log(`[SISTEMA]: ✅ Arquivo core detectado: ${coreFile} (${(fs.statSync(coreFile).size / 1024 / 1024).toFixed(2)} MB)`);
} else {
    console.error(`[SISTEMA]: ❌ ERRO: Arquivo core não encontrado em: ${coreFile}`);
}

// Headers de Segurança Removidos: BlackArrow não lida bem com CORP estrito localmente.

// Middleware de Verbose Logging (TOTAL)
app.use((req, res, next) => {
    // const start = Date.now();
    res.on('finish', () => {
        // const ms = Date.now() - start;
        // if (!req.url.startsWith('/api/')) {
        //     console.log(`🟢 [HTTP]: ${req.method} ${req.url} - ${res.statusCode} (${ms}ms)`);
        // }
    });
    next();
});

// Rota do Motor Principal (Mapeamento Dinâmico)
app.get(['/assets/app-hLqRDvZo.js', '/assets/app-CeovfBxX.js', '/assets/app-Dh291IPc.js'], (req, res) => {
    const corePath = path.join(__dirname, '../Top/assets/app-hLqRDvZo.js');
    if (!fs.existsSync(corePath)) return res.status(404).send("Core não encontrado");
    const stats = fs.statSync(corePath);
    console.log(`[SISTEMA]: 📦 Enviando Core (${(stats.size / 1024 / 1024).toFixed(2)} MB) para ${req.url}...`);

    res.set('Content-Type', 'application/javascript');
    res.sendFile(corePath, (err) => {
        if (err) {
            console.error(`❌ [SISTEMA]: Falha crítica ao entregar Motor Principal: ${err.message}`);
        } else {
            console.log(`🚀 [MOTOR]: Motor Principal entregue com sucesso! O terminal deve iniciar em breve.`);
        }
    });
});

// Suporte ao novo índice informado pelo usuário
app.get(['/assets/index-CGHnJCzV.js', '/assets/index-qjcXRtMe.js'], (req, res) => {
    const indexPath = path.join(__dirname, '../Top/assets/index-CGHnJCzV.js');
    if (!fs.existsSync(indexPath)) return res.status(404).send("Dicionário não encontrado");
    const stats = fs.statSync(indexPath);
    console.log(`[SISTEMA]: 📖 Enviando Dicionário (${(stats.size / 1024 / 1024).toFixed(2)} MB) para ${req.url}...`);
    res.set('Content-Type', 'application/javascript');
    res.sendFile(indexPath);
});

// Rota para o Motor de Cálculo (WASM)
app.get(['/assets/000460e2', '/wasm/000460e2'], (req, res) => {
    const wasmPath = path.join(__dirname, '../Top/assets/000460e2');
    if (!fs.existsSync(wasmPath)) {
        console.warn(`⚠️ [SISTEMA]: Motor WASM não encontrado em ${wasmPath}, mas continuando...`);
        return res.status(404).send("WASM não encontrado");
    }
    const stats = fs.statSync(wasmPath);
    console.log(`[SISTEMA]: ⚙️ Enviando Motor WASM (${(stats.size / 1024).toFixed(2)} KB) para ${req.url}...`);
    res.set('Content-Type', 'application/wasm');
    res.sendFile(wasmPath);
});

// Compatibilidade de Índice residual (Curinga)
app.get('/assets/index-*.js', (req, res) => {
    const indexPath = path.join(__dirname, '../Top/assets/index-CGHnJCzV.js');
    res.set('Content-Type', 'application/javascript');
    res.sendFile(indexPath);
});

// Suporte ao CSS
app.get(['/assets/app-CaZ16StA.css', '/assets/app-CnlPzUsG.css'], (req, res) => {
    const cssPath = path.join(__dirname, '../Top/assets/app-CaZ16StA.css');
    res.set('Content-Type', 'text/css');
    res.sendFile(cssPath);
});

// Serve o Worker original sem NENHUMA modificação
app.get('/assets/WebSocket.worker-*.js', (req, res) => {
    const workerPath = path.join(__dirname, '../Top/assets/WebSocket.worker-ATMf-q-b.js');
    if (!fs.existsSync(workerPath)) return res.status(404).send('Worker não encontrado');
    res.set('Content-Type', 'application/javascript');
    res.sendFile(workerPath);
});

// Suporte ao LogsWorker (Mapeamento de Hash)
app.get('/assets/LogsWorker.worker-*.js', (req, res) => {
    const workerPath = path.join(__dirname, '../Top/assets/LogsWorker.worker-sN1eXbax.js');
    if (!fs.existsSync(workerPath)) return res.status(404).send('LogsWorker não encontrado');
    res.set('Content-Type', 'application/javascript');
    res.sendFile(workerPath);
});
app.use(cors());
app.use(compression()); // GZIP: Reduz o Motor de 24MB para ~5MB na transferência
app.use(express.json({ limit: '50mb' }));
app.use(express.static(staticPath));

// --- BANCO DE DADOS ---
db.initDatabase().catch(console.error);

// --- MOTOR PYTHON ---
let scannerProcess = null;

function startPythonScanner() {
    if (process.platform !== "win32") return;
    console.log("[SISTEMA]: Faxina de processos...");
    try {
        execSync('taskkill /F /IM python.exe /T', { stdio: 'ignore' });
        execSync('taskkill /F /IM py.exe /T', { stdio: 'ignore' });
    } catch (e) { }

    setTimeout(() => {
        console.log("[SISTEMA]: Iniciando motor de dados...");
        scannerProcess = spawn('python', ['-u', path.join(__dirname, 'Market-Data.py')], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
        scannerProcess.stdout.on('data', (data) => process.stdout.write(`[PYTHON]: ${data}`));
        scannerProcess.stderr.on('data', (data) => process.stderr.write(`[PYTHON ERR]: ${data}`));
        scannerProcess.on('exit', (code) => {
            console.log(`[SISTEMA]: Motor Python encerrado (${code}).`);
            process.exit(0);
        });
    }, 1500);
}

// --- ROTEAMENTO DE MENSAGENS ---
// Envia NEW_DATA só para browsers (BlackArrow não deve receber protocolo do Python)
function broadcastToBrowsers(data) {
    const msg = JSON.stringify(data);
    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && !client.isPython) {
            client.send(msg);
            count++;
        }
    });
    return count;
}

// Envia mensagens de controle só para Python
function broadcastToPython(data) {
    const msg = JSON.stringify(data);
    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isPython) {
            client.send(msg);
            count++;
        }
    });
    return count;
}

// Legado: broadcast para todos (usado apenas para mensagens genéricas)
function broadcast(data) {
    const msg = JSON.stringify(data);
    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
            count++;
        }
    });
    // LOGS SILENCIADOS PARA LIMPEZA DO TERMINAL
}

// --- BUFFER ASSÍNCRONO DO BANCO (Desacopla o DB do fluxo ao vivo) ---
// Acumula trades na memória e grava na nuvem de 2 em 2 segundos
let dbWriteBuffer = [];
setInterval(() => {
    if (dbWriteBuffer.length === 0) return;
    const batch = dbWriteBuffer.splice(0, dbWriteBuffer.length);
    db.insertTrades(batch, 'LIVE').catch(err => {
        console.error(`❌ [DB FLUSH]: Falha ao gravar ${batch.length} trades: ${err.message}`);
    });
}, 2000);

wss.on('connection', async (ws, req) => {
    const userAgent = req.headers['user-agent'] || 'Desconhecido';
    const origin   = req.headers['origin']   || 'sem-origin';
    const type     = userAgent.includes('Mozilla') ? 'NAVEGADOR' : 'PYTHON';
    const clientId = Date.now();
    const totalClients = wss.clients.size;

    // --- MODO ISOLADO (ZENITH LOCAL ONLY) ---
    if (req.url && req.url.includes('/zenith-data')) {
        console.log(`🔌 [DADOS #${clientId}]: Motor Terminal conectado ao fluxo local (${req.url}).`);
        
        ws.on('message', (data) => {
            try {
                const rawMsg = data.toString();
                console.log(`[ZENITH-DATA] Recebido: ${rawMsg}`);
                
                const cmd = JSON.parse(rawMsg);
                if (cmd.type === 'REQUEST_SECURITY_LIST') {
                    // Monta a lista dinamicamente apenas com os ativos que o Python detectou
                    const assetList = Array.from(activeAssets).map(ticker => ({
                        label: ticker,
                        value: ticker,
                        asset: ticker,
                        desc: 'Ativo Lendo em Tempo Real',
                        strType: 'ASSET',
                        exchange: 66,
                        bolsa: 66
                    }));
                    
                    ws.send(JSON.stringify({
                        type: 'ASSET_LIST_RESPONSE',
                        assets: assetList
                    }));
                    console.log(`[ZENITH] 📡 Resposta rápida via /zenith-data: ${assetList.length} ativos para a Lupa.`);
                }
            } catch (e) {
                console.error('[ZENITH-DATA] Erro interno:', e);
            }
        });

        ws.on('close', () => console.log(`🔌 [DADOS #${clientId}]: Fluxo local encerrado.`));
        return;
    }
    // --- FIM DO MODO ISOLADO ---

    console.log(`[WS #${clientId}]: NOVO CLIENTE conectado. Total: ${totalClients}`);
    console.log(`  → User-Agent: ${userAgent.substring(0, 80)}`);
    console.log(`  → Origin: ${origin}`);
    console.log(`  → IP: ${req.socket.remoteAddress}`);

    // HANDSHAKE IMEDIATO: BlackArrow espera que o servidor fale primeiro
    // Testamos vários formatos para descobrir qual o app aceita
    if (type === 'NAVEGADOR') {
        setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            
            const handshakes = [
                { type: 'CONNECTED',    status: 'OK',   version: '1.0' },
                { type: 'HANDSHAKE',    status: 'OK' },
                { type: 'AUTH_OK',      status: 'OK' },
                { type: 'SESSION',      connected: true },
                { connected: true,      ready: true },
            ];
            
            handshakes.forEach((msg, i) => {
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(msg));
                        // console.log(`  → 🤝 Handshake [${i}] enviado: ${JSON.stringify(msg)}`);
                    }
                }, i * 100); // 100ms entre cada tentativa
            });
        }, 200); // Aguarda 200ms após conexão
    }

    ws.on('message', async (message) => {
        const rawMsg = message.toString();
        
        // Loga TUDO (BlackArrow pode enviar qualquer formato)
        const preview = rawMsg.length > 200 ? rawMsg.substring(0, 200) + '...' : rawMsg;
        console.log(`📩 [WS #${clientId}] MSG (${rawMsg.length} bytes): ${preview}`);

        try {
            const cmd = JSON.parse(message);
            
            // Lógica de Identificação do Python
            if (cmd.origin === 'PYTHON_MOTOR' || cmd.type === 'PYTHON_CONNECT') {
                if (!ws.isPython) {
                    ws.isPython = true;
                    console.log("🌟 [SISTEMA]: Motor Python validado no fluxo.");
                }
            }

            // Dados ao vivo: Joga no BUFFER, não espera o banco
            if (cmd.type === 'NEW_DATA' && cmd.data && cmd.data.length > 0) {
                dbWriteBuffer.push(...cmd.data);
            }

            // ROTEAMENTO CORRETO:
            if (cmd.type === 'NEW_DATA') {
                // Captura o ativo ativo que chegou do Python para exibir na Lupa
                if (cmd.asset && cmd.asset !== '---' && cmd.asset !== 'HISTORICO') {
                    if (!activeAssets.has(cmd.asset)) {
                        activeAssets.add(cmd.asset);
                        console.log(`[ZENITH] ✅ Novo ativo detectado e adicionado à memória da Lupa: ${cmd.asset}`);
                    }
                }
                broadcastToBrowsers(cmd);
            } else if (ws.isPython) {
                if (cmd.type === 'GET_LAST_TS') {
                    try {
                        const lastTs = await db.getLastTimestamp(cmd.asset || 'NQ');
                        ws.send(JSON.stringify({ type: 'LAST_TS', asset: cmd.asset || 'NQ', timestamp: lastTs || 0 }));
                    } catch (err) {
                        console.error(`❌ [ERRO SQL]: ${err.message}`);
                    }
                }
            } else {
                // Mensagem do browser
                if (cmd.type === 'REQUEST_SECURITY_LIST') {
                    // Monta a lista dinamicamente apenas com os ativos que o Python detectou
                    const assetList = Array.from(activeAssets).map(ticker => ({
                        label: ticker,
                        value: ticker,
                        asset: ticker,
                        desc: 'Ativo Lendo em Tempo Real',
                        strType: 'ASSET',
                        exchange: 66,
                        bolsa: 66
                    }));
                    
                    ws.send(JSON.stringify({
                        type: 'ASSET_LIST_RESPONSE',
                        assets: assetList
                    }));
                    console.log(`[ZENITH] 📡 Enviando ${assetList.length} ativos ativos para a Lupa.`);
                }
            }
        } catch (e) { 
            // console.log(`⚠️ [ALERTA]: Mensagem não-JSON recebida`);
        }
    });

    ws.on('close', () => {
        if (ws.isPython) {
            console.log("[WS]: Motor Python desconectado.");
        } else {
            console.log(`[WS #${clientId}]: Browser desconectado.`);
        }
    });
});

// Rotas API
app.get('/api/settings', (req, res) => res.json({}));
app.post('/api/logs', (req, res) => {
    const { level, message, msg, details, timestamp } = req.body;
    const finalMsg = msg || message || ''; // Aceita ambos os formatos
    const timeStr = timestamp || new Date().toLocaleTimeString();
    const emoji = level === 'error' ? '❌' : (level === 'warn' ? '⚠️' : '📝');
    
    // Filtro de Limpeza: Só mostra mensagens cruciais (WebSocket, Sessão, Erro, Python)
    const isCritical = finalMsg.includes('🔌') || finalMsg.includes('🔑') || finalMsg.includes('🛡️') || finalMsg.includes('🚀') || level === 'error';

    if (isCritical) {
        console.log(`${emoji} [${timeStr}] [NAVEGADOR]: ${finalMsg}`);
    }

    // Grava tudo no arquivo de log para histórico, sem poluir o terminal
    const logLine = `${emoji} [${timeStr}] [NAVEGADOR]: ${finalMsg}${details ? ` | ${details}` : ''}\n`;
    fs.appendFile(path.join(__dirname, 'browser.log'), logLine, () => {});

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
startPythonScanner();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ZENITH ONLINE: Porta ${PORT}`);
});

app.use((req, res) => {
    console.log(`⚠️ [404]: ${req.url}`);
    res.status(404).send("Não encontrado");
});
