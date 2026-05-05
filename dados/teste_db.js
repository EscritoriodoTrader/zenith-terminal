const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://postgres.sgmtpsaornjwlzlrosen:%40G230134FOTPRINT@aws-1-sa-east-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

async function test() {
    try {
        const id = 'TESTE_' + Date.now();
        const query = 'INSERT INTO trades (id, timestamp, price, quantity, side) VALUES ($1, $2, $3, $4, $5)';
        await pool.query(query, [id, Date.now(), 18000.5, 10, 'BUY']);
        console.log('✅ SUCESSO: O Banco de Dados está funcionando!');
        
        const res = await pool.query('SELECT count(*) FROM trades');
        console.log('SALDO TOTAL:', res.rows[0].count);
    } catch (e) {
        console.error('❌ ERRO NO BANCO:', e.message);
    } finally {
        process.exit(0);
    }
}
test();
