import { query } from './connection';

(async () => {
  try {
    const res = await query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products' ORDER BY ordinal_position`
    );
    console.log('products table columns:');
    console.table(res.rows);
    process.exit(0);
  } catch (err) {
    console.error('Error querying columns:', err);
    process.exit(1);
  }
})();
