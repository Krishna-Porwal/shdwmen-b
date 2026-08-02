import 'dotenv/config';
import { query } from './src/db/connection';

async function run() {
  const reviews = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews'
    ORDER BY ordinal_position
  `);
  console.log('reviews schema:');
  console.dir(reviews.rows, { depth: null, colors: false });

  const orders = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
    ORDER BY ordinal_position
  `);
  console.log('orders schema:');
  console.dir(orders.rows, { depth: null, colors: false });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
