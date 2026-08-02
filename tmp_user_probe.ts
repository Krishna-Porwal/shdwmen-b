import 'dotenv/config';
import { query } from './src/db/connection';

(async () => {
  try {
    const res = await query(
      'SELECT id, name, email, role FROM users WHERE id = $1 LIMIT 1',
      ['user_3GgHSTRX3ulqHfCXZTu5QrOj027']
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
  process.exit(0);
})();
