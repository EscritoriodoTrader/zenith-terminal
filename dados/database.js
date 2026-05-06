require('dotenv').config();
const { Pool } = require('pg');

// Configuração do Pool de Conexão com o PostgreSQL (Supabase)
if (!process.env.DATABASE_URL) {
    console.error("❌ ERRO CRÍTICO: DATABASE_URL não encontrada no arquivo .env!");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Necessário para conexões externas com Supabase
    }
});

/**
 * Inicializa as tabelas no PostgreSQL
 */
async function initDatabase() {
    const client = await pool.connect();
    try {
        console.log("[DB]: Verificando tabelas no PostgreSQL...");
        
        // Criar tabela de trades se não existir
        // Usamos BIGINT para timestamp e DOUBLE PRECISION para preços
        await client.query(`
            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY,
                timestamp BIGINT,
                price DOUBLE PRECISION,
                quantity INTEGER,
                side TEXT
            )
        `);

        // Índice para acelerar a busca por tempo
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades (timestamp ASC)
        `);

        console.log("[DB]: Banco de dados na nuvem inicializado com sucesso.");
    } catch (err) {
        console.error("[DB ERROR]: Falha ao inicializar banco:", err.message);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Limpa o banco de dados completamente
 */
async function clearDatabase() {
    let client;
    try {
        client = await pool.connect();
        const res = await client.query("DELETE FROM trades");
        console.log(`[DB]: Banco de dados limpo com sucesso. Linhas removidas: ${res.rowCount}`);
        return true;
    } catch (err) {
        console.error("[DB ERROR]: Erro crítico ao limpar banco:", err.message);
        return false;
    } finally {
        if (client) client.release();
    }
}

/**
 * Insere um lote de trades no banco usando UNNEST para máxima performance
 * @param {Array} trades 
 */
async function insertTrades(trades) {
    if (!trades || trades.length === 0) return;

    try {
        // Técnica de UNNEST é muito mais rápida para inserções em massa no Postgres
        const ids = trades.map(t => t.id);
        const timestamps = trades.map(t => t.timestamp);
        const prices = trades.map(t => t.price);
        const quantities = trades.map(t => t.quantity);
        const sides = trades.map(t => t.side);

        const query = `
            INSERT INTO trades (id, timestamp, price, quantity, side)
            SELECT * FROM UNNEST($1::text[], $2::bigint[], $3::float8[], $4::int[], $5::text[])
            ON CONFLICT (id) DO NOTHING
        `;

        await pool.query(query, [ids, timestamps, prices, quantities, sides]);
    } catch (err) {
        console.error("[DB ERROR]: Erro na inserção em massa:", err.message);
    }
}

/**
 * Recupera os trades ordenados por tempo
 * Limitamos aos últimos 50.000 para não sobrecarregar o gráfico no carregamento inicial
 */
async function getTrades() {
    try {
        const res = await pool.query("SELECT * FROM trades ORDER BY timestamp DESC LIMIT 50000");
        return res.rows;
    } catch (err) {
        console.error("[DB ERROR]: Erro ao buscar trades:", err);
        return [];
    }
}

module.exports = { initDatabase, clearDatabase, insertTrades, getTrades };
