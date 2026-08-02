import 'dotenv/config';
import { query } from './src/db/connection';

(async () => {
  try {
    const reviews = await query('SELECT * FROM reviews LIMIT 10');
    console.log('reviews count:', reviews.rowCount);
    console.log(reviews.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
