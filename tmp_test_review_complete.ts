import { config } from 'dotenv';
config();

import { query, getClient } from './src/db/connection';
import { detectReviewSchemaInfo } from './src/utils/reviewCompatibility';

async function main() {
  try {
    console.log('\n=== Review Submission Test ===\n');

    // Check schema
    const schemaInfo = await detectReviewSchemaInfo((sql: string) => query(sql));
    console.log('Review Schema Info:', schemaInfo);

    // Get a sample product and user
    const productsRes = await query('SELECT id, merchant_id FROM products LIMIT 1');
    if (productsRes.rows.length === 0) {
      console.log('No products found in DB');
      return;
    }
    const productId = productsRes.rows[0].id;
    const merchantId = productsRes.rows[0].merchant_id;
    console.log('Sample product ID:', productId);
    console.log('Sample merchant ID:', merchantId);

    // Get or create a test user
    const testUserId = 'test_review_user_' + Date.now();
    const testUserEmail = `test_${Date.now()}@example.com`;
    await query(
      `INSERT INTO users (id, name, email, password, role) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [testUserId, 'Test User', testUserEmail, 'hashed', 'customer']
    );
    console.log('Test user ID:', testUserId);

    // Get or create a test order with delivered status
    const ordersRes = await query(
      `SELECT id FROM orders WHERE user_id = $1 AND status = 'delivered' LIMIT 1`,
      [testUserId]
    );
    let orderId: string;
    if (ordersRes.rows.length === 0) {
      orderId = 'order_' + Date.now();
      await query(
        `INSERT INTO orders (id, user_id, status, payment_method) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [orderId, testUserId, 'delivered', 'online']
      );
    } else {
      orderId = ordersRes.rows[0].id;
    }
    console.log('Order ID:', orderId);

    // Get or create a test order item
    const orderItemsRes = await query(
      `SELECT id FROM order_items WHERE order_id = $1 LIMIT 1`,
      [orderId]
    );
    let orderItemId: string;
    if (orderItemsRes.rows.length === 0) {
      orderItemId = 'oi_' + Date.now();
      await query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, price, product_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [orderItemId, orderId, productId, 1, 100, JSON.stringify({ product_name: 'Test Product' })]
      );
    } else {
      orderItemId = orderItemsRes.rows[0].id;
    }
    console.log('Order item ID:', orderItemId);

    console.log('\n--- Test 1: Rating Only ---');
    const insertParams1: any[] = [orderItemId, productId, 5, testUserId];
    const expectedSql1 = `SELECT oi.id,
        oi.product_id,
        o.id AS order_id,
        o.status,
        p.merchant_id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE oi.id = $1 AND oi.product_id = $2 AND o.user_id = $3
       LIMIT 1`;
    console.log('Checking order item...');
    const checkRes = await query(expectedSql1, [orderItemId, productId, testUserId]);
    if (checkRes.rows.length === 0) {
      console.log('ERROR: Order item check failed');
      return;
    }
    console.log('✓ Order item found');

    console.log('\n--- Test 2: Rating + Review Text (NO images) ---');
    const reviewText2 = 'This is a great product with excellent quality!';
    try {
      const insertSql2 = `INSERT INTO reviews (id, product_id, user_id, rating, ${schemaInfo.hasReview ? 'review' : 'comment'}, ${schemaInfo.hasTitle ? 'title' : ''})
       VALUES ($1, $2, $3, $4, $5${schemaInfo.hasTitle ? ', $6' : ''})`;
      const insertParams2 = ['review_' + Date.now(), productId, testUserId, 4, reviewText2];
      if (schemaInfo.hasTitle) insertParams2.push('Great Quality');
      console.log('Insert SQL:', insertSql2);
      console.log('Insert params:', insertParams2);
      await query(insertSql2, insertParams2);
      console.log('✓ Rating + review inserted successfully');
    } catch (err: any) {
      console.log('ERROR:', err.message);
      if (err.message.includes('could not determine data type of parameter')) {
        console.log('🚨 FOUND THE BUG: Data type determination issue');
      }
    }

    console.log('\n--- Test 3: Rating + Review Text + Images ---');
    if (schemaInfo.hasReviewImages) {
      const reviewImages = ['https://res.cloudinary.com/demo/image/upload/v123/test1.jpg', 'https://res.cloudinary.com/demo/image/upload/v123/test2.jpg'];
      try {
        const reviewId3 = 'review_' + Date.now();
        let nextParam = 4;
        const insertCols = ['id', 'product_id', 'user_id', 'rating'];
        const insertParams3: any[] = [reviewId3, productId, testUserId, 3];

        if (schemaInfo.hasReview) {
          insertCols.push('review');
          insertParams3.push(reviewText2);
          nextParam += 1;
        }
        if (schemaInfo.hasTitle) {
          insertCols.push('title');
          insertParams3.push('Good Product');
          nextParam += 1;
        }
        if (schemaInfo.hasReviewImages) {
          insertCols.push('review_images');
          insertParams3.push(JSON.stringify(reviewImages));
          nextParam += 1;
        }

        const placeholders = insertCols.map((col, idx) => {
          if (col === 'review_images') return `$${idx + 1}::jsonb`;
          return `$${idx + 1}`;
        }).join(', ');

        const insertSql3 = `INSERT INTO reviews (${insertCols.join(', ')}) VALUES (${placeholders})`;
        console.log('Insert SQL:', insertSql3);
        console.log('Insert params:', insertParams3);
        await query(insertSql3, insertParams3);
        console.log('✓ Rating + review + images inserted successfully');

        // Try to retrieve
        const selectSql = `SELECT id, rating, review_images FROM reviews WHERE id = $1`;
        const retrieved = await query(selectSql, [reviewId3]);
        if (retrieved.rows.length > 0) {
          console.log('✓ Retrieved review:', retrieved.rows[0]);
        }
      } catch (err: any) {
        console.log('ERROR:', err.message);
        if (err.message.includes('could not determine data type of parameter')) {
          console.log('🚨 FOUND THE BUG: Data type determination issue');
        }
      }
    } else {
      console.log('⚠ Schema does not support review_images');
    }

    console.log('\n=== Test Complete ===\n');
  } catch (error) {
    console.error('Test error:', error);
  }
  process.exit(0);
}

main();
