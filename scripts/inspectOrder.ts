import { query } from '../src/db/connection';

async function main() {
  const orderId = process.argv[2] || '7189f6f1-00d7-4f00-bd47-b28f44592be8';
  try {
    const res = await query(
      `SELECT oi.id as oi_id, oi.product_id, oi.quantity, oi.price, oi.product_snapshot, p.image_url as product_image
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Query failed', err);
    process.exit(1);
  }
  process.exit(0);
}

main();
