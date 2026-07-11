require('dotenv').config();
const { Pool } = require('pg');

const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/check_product.js <product_id>');
  process.exit(1);
}

(async () => {
  try {
    const res = await pool.query('SELECT id, name, price, stock FROM products WHERE id = $1', [id]);
    if (res.rows.length === 0) {
      console.log(`NOT_FOUND ${id}`);
    } else {
      console.log('FOUND', JSON.stringify(res.rows[0], null, 2));
    }
  } catch (e) {
    console.error('Query error:', e);
  } finally {
    await pool.end();
  }
})();
