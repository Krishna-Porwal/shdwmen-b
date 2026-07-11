require('dotenv').config();
const { Pool } = require('pg');

const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products' ORDER BY ordinal_position");
    console.log('products table columns:');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error('Query error:', e);
  } finally {
    await pool.end();
  }
})();
