import { query } from './connection';
import logger from '../logger';

(async () => {
  try {
    const res = await query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products' ORDER BY ordinal_position`
    );
    logger.info('products table columns:');
    console.table(res.rows);
    process.exit(0);
  } catch (err) {
    logger.error('Error querying columns:', err);
    process.exit(1);
  }
})();
