require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_SERVER,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT,
});

async function checkTable() {
    try {
        const res = await pool.query("SELECT * FROM api.forecast_data LIMIT 1");
        console.log('TABLE DATA:', JSON.stringify(res.rows));
    } catch (e) {
        console.log('TABLE DOES NOT EXIST OR ERROR:', e.message);
    } finally {
        await pool.end();
    }
}
checkTable();
