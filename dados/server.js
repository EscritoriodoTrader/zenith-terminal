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
const activeAssets = new Map();

const staticPath = path.join(__dirname, '../Top');
console.log(`[SISTEMA]: Servindo arquivos estáticos de: ${staticPath}`);

// Removido checagens legadas da BlackArrow.
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

// As rotas de arquivos estáticos da BlackArrow foram completamente removidas.
// Serve o Gráfico Próprio (Zenith Chart)
const graficoPath = path.join(__dirname, '../Grafico');
if (fs.existsSync(graficoPath)) {
    app.use('/grafico', express.static(graficoPath));
    console.log(`[SISTEMA]: 📊 Gráfico próprio disponível em /grafico`);
}

app.use(cors());
app.use(compression()); // GZIP: Reduz o Motor de 24MB para ~5MB na transferência
app.use(express.json({ limit: '50mb' }));
app.use(express.static(staticPath));

// Redireciona localhost:3000 direto para o gráfico
app.get('/', (req, res) => {
    res.redirect('/grafico/');
});

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
        scannerProcess = spawn(path.join(__dirname, 'csharp/MarketDataRTD.exe'), [], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
        scannerProcess.stdout.on('data', (data) => process.stdout.write(`[ZENITH C#]: ${data}`));
        scannerProcess.stderr.on('data', (data) => process.stderr.write(`[ZENITH C# ERR]: ${data}`));
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
    const origin = req.headers['origin'] || 'sem-origin';
    const type = userAgent.includes('Mozilla') ? 'NAVEGADOR' : 'PYTHON';
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
                    const assetList = Array.from(activeAssets.entries()).map(([ticker, info]) => ({
                        label: ticker,
                        value: ticker,
                        asset: ticker,
                        desc: 'Sinal em Tempo Real',
                        strType: 'ASSET',
                        exchange: 'Z-RT',
                        bolsa: 'Z-RT',
                        price: info.lastPrice,
                        var: info.variation
                    }));

                    // Adiciona opções fixas do Zenith
                    assetList.push(
                        { label: 'HISTORICO', value: 'HISTORICO', asset: 'HISTORICO', desc: 'Carregar Arquivo Local', exchange: 'LOCAL', type: 'Todas', price: 0, var: 0 },
                        { label: '1', value: '1', asset: '1', desc: '1 Minuto', exchange: 'PERIOD', type: 'Período', price: 0, var: 0 },
                        { label: '2', value: '2', asset: '2', desc: '2 Minutos', exchange: 'PERIOD', type: 'Período', price: 0, var: 0 },
                        { label: '3', value: '3', asset: '3', desc: '3 Minutos', exchange: 'PERIOD', type: 'Período', price: 0, var: 0 },
                        { label: '5', value: '5', asset: '5', desc: '5 Minutos', exchange: 'PERIOD', type: 'Período', price: 0, var: 0 },
                        { label: '15', value: '15', asset: '15', desc: '15 Minutos', exchange: 'PERIOD', type: 'Período', price: 0, var: 0 },
                        { label: '60', value: '60', asset: '60', desc: '1 Hora', exchange: 'PERIOD', type: 'Período', price: 0, var: 0 },
                        { label: 'D', value: 'D', asset: 'D', desc: 'Diário', exchange: 'PERIOD', type: 'Período', price: 0, var: 0 }
                    );

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
                { type: 'CONNECTED', status: 'OK', version: '1.0' },
                { type: 'HANDSHAKE', status: 'OK' },
                { type: 'AUTH_OK', status: 'OK' },
                { type: 'SESSION', connected: true },
                { connected: true, ready: true },
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

            // Lógica de Identificação do Python (Singleton: fecha conexão antiga)
            if (cmd.origin === 'PYTHON_MOTOR' || cmd.type === 'PYTHON_CONNECT') {
                if (!ws.isPython) {
                    // Fecha qualquer conexão Python anterior para evitar duplicatas
                    wss.clients.forEach(client => {
                        if (client !== ws && client.isPython && client.readyState === WebSocket.OPEN) {
                            console.log("⚠️ [SISTEMA]: Conexão Python duplicada detectada. Encerrando a antiga...");
                            client.terminate();
                        }
                    });
                    ws.isPython = true;
                    console.log("🌟 [SISTEMA]: Motor Python validado no fluxo.");
                }
            }

            // Dados ao vivo: Transforma as Tuplas brutas do Python em Objetos estruturados
            if (cmd.type === 'NEW_DATA' && cmd.data && cmd.data.length > 0) {
                if (Array.isArray(cmd.data[0])) {
                    cmd.data = cmd.data.map(row => {
                        globalTradeSeq++;
                        const [ts, p, q, side, buyer, seller] = row;
                        return {
                            id: `${cmd.asset}_${ts}_${p}_${q}_${side}_seq${globalTradeSeq}`,
                            timestamp: ts,
                            price: p,
                            quantity: q,
                            side: side,
                            asset: cmd.asset || 'DESCONHECIDO',
                            buyer: buyer || '-',
                            seller: seller || '-'
                        };
                    });
                }
                dbWriteBuffer.push(...cmd.data);
            }

            // ROTEAMENTO CORRETO:
            if (cmd.type === 'NEW_DATA') {
                // Captura o ativo ativo que chegou do Python para exibir na Lupa
                if (cmd.asset && cmd.asset !== '---' && cmd.asset !== 'HISTORICO') {
                    if (!activeAssets.has(cmd.asset)) {
                        console.log(`[ZENITH] ✅ Novo ativo detectado e adicionado à memória da Lupa: ${cmd.asset}`);
                    }
                    // Atualiza o Map com o último preço e variação reais do Python
                    activeAssets.set(cmd.asset, {
                        lastPrice: cmd.lastPrice || 0,
                        variation: cmd.variation || 0
                    });
                }
                broadcastToBrowsers(cmd);
            } else if (ws.isPython) {
                if (cmd.type === 'GET_LAST_TS') {
                    try {
                        const lastTs = await db.getLastTimestamp(cmd.asset || 'NQ');
                        ws.send(JSON.stringify({ type: 'LAST_TS', asset: cmd.asset || 'NQ', timestamp: lastTs || 0, data: lastTs || 0 }));
                    } catch (err) {
                        console.error(`❌ [ERRO SQL]: ${err.message}`);
                    }
                } else if (cmd.type === 'PYTHON_CONNECT') {
                    // Avisa o navegador que o motor conectou
                    broadcastToBrowsers({ type: 'PYTHON_CONNECT' });
                }
            } else {
                // Mensagem do browser
                if (cmd.type === 'REQUEST_SECURITY_LIST') {
                    // Monta a lista dinamicamente apenas com os ativos que o Python detectou
                    const assetList = Array.from(activeAssets.entries()).map(([ticker, info]) => ({
                        label: ticker,
                        value: ticker,
                        asset: ticker,
                        desc: 'Sinal em Tempo Real',
                        strType: 'ASSET',
                        exchange: 'Z-RT',
                        bolsa: 'Z-RT',
                        price: info.lastPrice,
                        var: info.variation
                    }));

                    // Adiciona opções fixas do Zenith
                    assetList.push(
                        { label: '1', value: '1', asset: '1', desc: '1 Minuto', exchange: 'Período', type: 'Período', price: 0, var: 0 },
                        { label: '2', value: '2', asset: '2', desc: '2 Minutos', exchange: 'Período', type: 'Período', price: 0, var: 0 },
                        { label: '3', value: '3', asset: '3', desc: '3 Minutos', exchange: 'Período', type: 'Período', price: 0, var: 0 },
                        { label: '5', value: '5', asset: '5', desc: '5 Minutos', exchange: 'Período', type: 'Período', price: 0, var: 0 },
                        { label: '15', value: '15', asset: '15', desc: '15 Minutos', exchange: 'Período', type: 'Período', price: 0, var: 0 },
                        { label: '30', value: '30', asset: '30', desc: '30 Minutos', exchange: 'Período', type: 'Período', price: 0, var: 0 },
                        { label: '60', value: '60', asset: '60', desc: '1 Hora', exchange: 'Período', type: 'Período', price: 0, var: 0 },
                        { label: '1D', value: '1D', asset: '1D', desc: 'Diário', exchange: 'Período', type: 'Período', price: 0, var: 0 }
                    );

                    ws.send(JSON.stringify({
                        type: 'ASSET_LIST_RESPONSE',
                        assets: assetList
                    }));
                    console.log(`[ZENITH] 📡 Enviando ${assetList.length} ativos ativos para a Lupa.`);
                } else if (cmd.type === 'RELOAD_HISTORY') {
                    console.log("[SISTEMA]: 📜 Comando RELOAD_HISTORY recebido! Disparando Historico.py...");
                    const histPath = path.join(__dirname, 'python/Historico.py');
                    const child = spawn('python', [histPath], { stdio: 'inherit', shell: true });
                    child.on('exit', (code) => {
                        console.log(`[SISTEMA]: Historico.py finalizado com código ${code}.`);
                    });
                    broadcastToPython(cmd);
                    broadcastToBrowsers(cmd);
                } else if (cmd.type === 'RUN_PYTHON_HISTORY') {
                    console.log("[SISTEMA]: 🐍 Autorização de leitura de histórico recebida! Disparando Historico.py...");
                    broadcastToBrowsers({ type: 'PYTHON_HISTORY_START' });
                    
                    const histPath = path.join(__dirname, 'python/Historico.py');
                    const child = spawn('python', [histPath], { stdio: 'inherit', shell: true });
                    child.on('exit', (code) => {
                        console.log(`[SISTEMA]: Historico.py finalizado com código ${code}.`);
                        broadcastToBrowsers({ 
                            type: 'PYTHON_HISTORY_END', 
                            success: code === 0 
                        });
                    });
                } else if (cmd.type === 'TOGGLE_MOTOR' || cmd.type === 'CLEAR_CHART') {
                    // Repassa os comandos de controle de fluxo para o motor Python
                    broadcastToPython(cmd);
                    // E atualiza os outros navegadores conectados
                    broadcastToBrowsers(cmd);
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
app.get('/api/trades/:asset', async (req, res) => {
    const { asset } = req.params;
    try {
        const trades = await db.getTradesForAsset(asset);
        res.json(trades);
    } catch (err) {
        console.error(`❌ [API TRADES]: Falha ao buscar trades para ${asset}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

let globalTradeSeq = 0;

app.post('/api/trades', async (req, res) => {
    try {
        const { asset, data, isHistory, lastPrice, variation } = req.body;
        
        let processedData = [];
        if (data && data.length > 0) {
            // Verifica se os dados vieram no formato bruto de array (RAW TUPLES do Python)
            if (Array.isArray(data[0])) {
                processedData = data.map(row => {
                    globalTradeSeq++;
                    // Formato enviado pelo Python: [ts, price, qty, side, acp_str, avd_str]
                    const [ts, p, q, side, buyer, seller] = row;
                    // UID baseado no conteúdo para permitir deduplicação
                    const uid = `${asset}_${ts}_${p}_${q}_${side}`;
                    return {
                        id: uid,
                        timestamp: ts,
                        price: p,
                        quantity: q,
                        side: side,
                        asset: asset || 'DESCONHECIDO',
                        buyer: buyer || '-',
                        seller: seller || '-'
                    };
                });
            } else {
                // Dados já pré-formatados (C# envia neste formato com id próprio)
                // Respeita o id que veio do C# para permitir deduplicação
                processedData = data;
            }


            await db.insertTrades(processedData, asset || 'DESCONHECIDO');
            if (!isHistory) {
                // Adiciona o ativo ativo detectado à Lupa se não existir
                if (asset && asset !== '---' && asset !== 'HISTORICO') {
                    if (!activeAssets.has(asset)) {
                        console.log(`[ZENITH] ✅ Novo ativo detectado via C# HTTP POST: ${asset}`);
                    }
                    activeAssets.set(asset, {
                        lastPrice: lastPrice || 0,
                        variation: variation || 0
                    });
                }

                broadcastToBrowsers({
                    type: 'NEW_DATA',
                    asset: asset || 'DESCONHECIDO',
                    lastPrice: lastPrice || 0,
                    variation: variation || 0,
                    data: processedData
                });
            }
        }
        res.json({ success: true, count: processedData.length });
    } catch (err) {
        console.error("❌ [API TRADES POST]: Falha ao salvar trades:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/trades/prepare-history', async (req, res) => {
    try {
        const { asset, maxTimestamp } = req.body;
        if (!asset || !maxTimestamp) {
            return res.status(400).json({ error: 'Faltando asset ou maxTimestamp' });
        }
        
        console.log(`🧹 [SISTEMA]: Preparando importação de histórico de ${asset}. Removendo sobreposições até ${new Date(maxTimestamp).toISOString()}...`);
        
        // 1. Limpa os registros do banco de dados que ocorrem antes do último trade do histórico
        const deletedCount = await db.deleteTradesBefore(asset, maxTimestamp);
        
        // 2. Avisa o motor Python (Market-Data.py) do novo limite temporal em tempo real
        broadcastToPython({
            type: 'LAST_TS',
            data: maxTimestamp
        });
        
        res.json({ success: true, deletedCount });
    } catch (err) {
        console.error("❌ [API PREPARE HISTORY]: Falha ao preparar histórico:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/control/open-terminal', (req, res) => {
    try {
        console.log("🖥️ [SISTEMA]: Iniciando terminal visível no Windows...");
        const { exec } = require('child_process');
        // Abre um prompt de comando visível (permanece aberto via /k) e inicia o npm run dev
        exec('start cmd.exe /k "title Zenith Terminal (Node & Python) && cd /d c:\\FOOTPRINT\\dados && npm run dev"');
        res.json({ success: true, message: 'Terminal abrindo no Windows...' });
        
        // Encerra este processo invisível em background em 800ms para liberar a porta 3000
        setTimeout(() => {
            console.log("👋 [SISTEMA]: Encerrando servidor invisível para dar lugar ao terminal visível.");
            process.exit(0);
        }, 800);
    } catch (err) {
        console.error("❌ [API TERMINAL]: Erro ao abrir terminal:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/control/shutdown', (req, res) => {
    try {
        console.log("🛑 [SISTEMA]: Solicitação de encerramento total recebida do navegador...");
        
        // Envia resposta rápida antes de derrubar o servidor
        res.json({ success: true, message: 'Zenith Terminal encerrando...' });
        
        // Finaliza processos do Python
        try {
            const { execSync } = require('child_process');
            execSync('taskkill /F /IM python.exe /T', { stdio: 'ignore' });
            execSync('taskkill /F /IM py.exe /T', { stdio: 'ignore' });
        } catch (e) { }

        // Desliga o servidor Node em 500ms
        setTimeout(() => {
            console.log("👋 [SISTEMA]: Servidor encerrado por comando do navegador.");
            process.exit(0);
        }, 500);
    } catch (err) {
        console.error("❌ [API SHUTDOWN]: Erro ao encerrar servidor:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/trades/clear', async (req, res) => {
    try {
        console.log("🧹 [DB]: Solicitação de limpeza total de dados recebida...");
        const success = await db.clearDatabase();
        activeAssets.clear(); // Limpa ativos na RAM do Node
        dbWriteBuffer = [];   // Limpa buffer na RAM do Node
        
        // Envia mensagem via WS para todos os navegadores para resetarem o CandleBuilder local
        broadcastToBrowsers({ type: 'CLEAR_CHART' });
        
        res.json({ success });
    } catch (err) {
        console.error("❌ [API CLEAR]: Falha ao limpar banco:", err.message);
        res.status(500).json({ error: err.message });
    }
});

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
    fs.appendFile(path.join(__dirname, 'logs/browser.log'), logLine, () => { });

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
