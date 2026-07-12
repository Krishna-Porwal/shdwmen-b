import 'dotenv/config';
import { query } from '../src/db/connection';

async function backfill() {
  console.log('Starting sold_count backfill...');

  try {
    // Aggregate sold quantities from non-cancelled orders
    const res = await query(`
      SELECT p.id AS product_id, COALESCE(SUM(oi.quantity), 0) AS sold_count
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.id
      LEFT JOIN orders o ON oi.order_id = o.id
      WHERE o.status IS NULL OR o.status != 'cancelled'
      GROUP BY p.id
    `);

    console.log(`Found ${res.rows.length} products to update`);

    for (const row of res.rows) {
      const productId = row.product_id;
      const soldCount = Number(row.sold_count || 0);

      await query('UPDATE products SET sold_count = $1 WHERE id = $2', [soldCount, productId]);
    }

    console.log('Backfill completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exit(1);
  }
}

backfill();
