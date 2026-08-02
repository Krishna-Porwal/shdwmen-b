import 'dotenv/config';
import { query } from './src/db/connection';

(async () => {
  try {
    const result = await query(`SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reviews'
      ORDER BY ordinal_position`);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
  process.exit(0);
})();
