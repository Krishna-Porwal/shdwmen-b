import { config } from 'dotenv';
config();

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL_MODE !== 'disable' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('\n=== REVIEW SUBMISSION SQL TEST ===\n');

    // Test 1: Check schema
    const schemaRes = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reviews'
      ORDER BY ordinal_position
    `);
    const columns = schemaRes.rows.map(r => r.column_name);
    console.log('Review columns:', columns);
    const hasReviewImages = columns.includes('review_images');
    console.log('Has review_images:', hasReviewImages);

    // Test 2: Try to insert with JSONB cast (this is what the backend does)
    console.log('\n--- Simulating Backend INSERT with JSONB ---');
    const reviewId = uuidv4();
    const productId = (await pool.query('SELECT id FROM products LIMIT 1')).rows[0]?.id || uuidv4();
    const userId = 'user_test_' + Date.now();

    try {
      // This is the pattern the backend uses:
      const columns_array = ['id', 'product_id', 'user_id', 'rating'];
      const params_array = [reviewId, productId, userId, 5];
      let paramIndex = 5; // Next placeholder index

      if (hasReviewImages) {
        columns_array.push('review_images');
        params_array.push(JSON.stringify(['https://example.com/img1.jpg']));
      }

      const placeholders = columns_array.map((col, idx) => {
        const pIdx = idx + 1;
        if (col === 'review_images') return `$${pIdx}::jsonb`;
        return `$${pIdx}`;
      }).join(', ');

      const sql = `INSERT INTO reviews (${columns_array.join(', ')}) VALUES (${placeholders})`;
      console.log('SQL:', sql);
      console.log('Params:', params_array);

      await pool.query(sql, params_array);
      console.log('✓ Insert successful');
    } catch (err: any) {
      console.log('✗ Insert failed:', err.message);
      if (err.message.includes('could not determine data type')) {
        console.log('🚨 FOUND BUG: Data type determination error');
      }
    }

    // Test 3: Test UPDATE with JSONB
    console.log('\n--- Simulating Backend UPDATE with JSONB ---');
    if (hasReviewImages) {
      try {
        const updateSql = `UPDATE reviews SET review_images = $1::jsonb WHERE id = $2`;
        const updateParams = [JSON.stringify(['https://example.com/img2.jpg']), reviewId];
        console.log('SQL:', updateSql);
        console.log('Params:', updateParams);
        
        const result = await pool.query(updateSql, updateParams);
        console.log('✓ Update successful. Rows affected:', result.rowCount);
      } catch (err: any) {
        console.log('✗ Update failed:', err.message);
      }
    }

    console.log('\n=== TEST COMPLETE ===\n');
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
