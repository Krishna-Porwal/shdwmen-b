import 'dotenv/config';
import { query } from './src/db/connection';

(async () => {
  try {
    const userId = 'user_3GgHSTRX3ulqHfCXZTu5QrOj027';
    const name = 'Test User';
    const email = 'test@example.com';
    const res = await query(
      `INSERT INTO users (id, name, email, password, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, name, email, 'clerk_auth', 'customer']
    );
    console.log('Insert result:', res.rowCount);
  } catch (err:any) {
    const util = require('util');
    console.error('Insert error:', err && err.code, err && err.constraint, err && err.message);
    try {
      console.error('Full error:', util.inspect(err, { showHidden: true, depth: null }));
    } catch (e) {
      console.error('Full error fallback:', err);
    }

    console.log('Attempting fallback insert without email...');
    try {
      const fallback = await query(
        `INSERT INTO users (id, name, password, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = CURRENT_TIMESTAMP`,
        ['user_3GgHSTRX3ulqHfCXZTu5QrOj027', 'Test User', 'clerk_auth', 'customer']
      );
      console.log('Fallback result:', fallback.rowCount);
    } catch (innerErr:any) {
      console.error('Fallback error:', innerErr && innerErr.code, innerErr && innerErr.constraint, innerErr && innerErr.message);
      console.error('Fallback full:', util.inspect(innerErr, { showHidden: true, depth: null }));
    }
  } finally {
    process.exit(0);
  }
})();
