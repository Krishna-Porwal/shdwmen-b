const { query } = require('./dist/db/connection.js');

(async () => {
  const res = await query('SELECT id FROM orders ORDER BY created_at DESC LIMIT 1');
  console.log(JSON.stringify(res.rows));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
