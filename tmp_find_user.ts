import 'dotenv/config';
import { query } from './src/db/connection';

(async () => {
  try {
    const email = 'test@example.com';
    const res = await query('SELECT id, email, name, created_at FROM users WHERE email = $1', [email]);
    console.log('Rows:', res.rows.length);
    console.dir(res.rows, { depth: null });
  } catch (err) {
    console.error('Query error:', err);
  } finally {
    process.exit(0);
  }
})();
