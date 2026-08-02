import 'dotenv/config';
import { query } from './src/db/connection';

(async () => {
  try {
    const res = await query(`
      SELECT oi.id AS order_item_id, oi.product_id, oi.order_id, o.user_id, o.status, p.name AS product_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status = 'delivered'
      LIMIT 5
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
  process.exit(0);
})();
