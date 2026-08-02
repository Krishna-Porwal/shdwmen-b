import 'dotenv/config';
import { query } from './src/db/connection';

(async () => {
  try {
    const res = await query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'users'
       ORDER BY ordinal_position`);
    console.dir(res.rows, { depth: null });
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
