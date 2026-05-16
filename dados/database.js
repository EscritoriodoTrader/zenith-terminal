const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
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
        // O ID é TEXT pois usamos uma combinação de dados para gerar um UID único
        await client.query(`
            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY,
                asset TEXT,
                timestamp BIGINT,
                price DOUBLE PRECISION,
                quantity INTEGER,
                side TEXT
            )
        `);

        // Correção de Tipo: Se a coluna 'id' existir mas for inteira, converter para TEXT
        // Isso resolve o erro: "column id is of type integer but expression is of type text"
        await client.query(`
            DO $$ 
            BEGIN 
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'trades' AND column_name = 'id' AND data_type = 'integer'
                ) THEN 
                    ALTER TABLE trades ALTER COLUMN id TYPE TEXT;
                END IF;
            END $$;
        `);

        // Adicionar coluna 'asset' se não existir (Migração para Multi-Ativo)
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'trades' AND column_name = 'asset'
                ) THEN 
                    ALTER TABLE trades ADD COLUMN asset TEXT;
                END IF;
            END $$;
        `);

        // Índice para acelerar a busca por tempo
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades (timestamp ASC)
        `);

        console.log("[DB]: Banco de dados na nuvem sincronizado com o motor.");
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
async function insertTrades(trades, assetName = 'DESCONHECIDO') {
    if (!trades || trades.length === 0) return;

    try {
        const ids = trades.map(t => t.id);
        const assets = trades.map(t => t.asset || assetName); // Usa o do objeto ou o global do lote
        const timestamps = trades.map(t => t.timestamp);
        const prices = trades.map(t => t.price);
        const quantities = trades.map(t => t.quantity);
        const sides = trades.map(t => t.side);

        const query = `
            INSERT INTO trades (id, asset, timestamp, price, quantity, side)
            SELECT * FROM UNNEST($1::text[], $2::text[], $3::bigint[], $4::float8[], $5::int[], $6::text[])
            ON CONFLICT (id) DO NOTHING
        `;

        await pool.query(query, [ids, assets, timestamps, prices, quantities, sides]);
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
        // Buscamos em ordem CRESCENTE para que o limite de memória do gráfico (shift) remova os velhos e mantenha os novos
        const res = await pool.query("SELECT * FROM trades ORDER BY timestamp ASC");
        return res.rows;
    } catch (err) {
        console.error("[DB ERROR]: Erro ao buscar trades:", err);
        return [];
    }
}

/**
 * Busca o maior timestamp já salvo no banco para sincronização rápida do histórico
 */
async function getLastTimestamp() {
    try {
        const res = await pool.query("SELECT MAX(timestamp) as last_ts FROM trades");
        return res.rows[0]?.last_ts || 0;
    } catch (err) {
        console.error("[DB ERROR]: Erro ao buscar último timestamp:", err);
        return 0;
    }
}

/**
 * Recupera trades com timestamp maior que o fornecido (para preencher gap RTD apos historico)
 */
async function getTradesAfter(timestamp) {
    try {
        const res = await pool.query(
            "SELECT * FROM trades WHERE timestamp > $1 ORDER BY timestamp ASC",
            [timestamp]
        );
        return res.rows;
    } catch (err) {
        console.error("[DB ERROR]: Erro ao buscar trades apos timestamp:", err);
        return [];
    }
}

module.exports = { initDatabase, clearDatabase, insertTrades, getTrades, getLastTimestamp, getTradesAfter };
