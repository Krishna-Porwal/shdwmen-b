require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reviews' ORDER BY ordinal_position")
  .then(res => {
    console.log(res.rows);
    return pool.end();
  })
  .catch(err => {
    console.error('ERROR', err.message);
    return pool.end().then(() => process.exit(1));
  });
