require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_SERVER,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT,
});

async function listTables() {
    try {
        const res = await pool.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')");
        console.log('TABLES:', JSON.stringify(res.rows));
    } catch (e) {
        console.log('ERROR:', e.message);
    } finally {
        await pool.end();
    }
}
listTables();
