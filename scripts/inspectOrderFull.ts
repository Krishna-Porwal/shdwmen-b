import { query } from '../src/db/connection';

async function main() {
  const orderId = process.argv[2] || '7189f6f1-00d7-4f00-bd47-b28f44592be8';
  const userId = process.argv[3] || 'user_3FVO4E07cfgTW5cWdUFqOmT2ixj';
  try {
    const res = await query(
      `SELECT o.id,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity, 'price', oi.price, 'product_image', COALESCE((oi.product_snapshot->>'product_image'), p.image_url))) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb)
        FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id
      ) as items
     FROM orders o
     WHERE o.id = $1 AND o.user_id = $2`,
      [orderId, userId]
    );
    console.log(JSON.stringify(res.rows[0], null, 2));
  } catch (err) {
    console.error('Query failed', err);
    process.exit(1);
  }
  process.exit(0);
}

main();
