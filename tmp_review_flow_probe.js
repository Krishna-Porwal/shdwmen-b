require('dotenv').config();
const { query } = require('./src/db/connection');
const { detectReviewSchemaInfo, buildReviewInsertConfig } = require('./src/utils/reviewCompatibility');

(async () => {
  try {
    console.log('=== Review schema columns ===');
    const columns = await query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reviews' ORDER BY ordinal_position`);
    console.log(columns.rows);

    console.log('\n=== Sample delivered order items ===');
    const orderData = await query(`SELECT oi.id as order_item_id, oi.product_id, o.user_id, o.status, p.merchant_id FROM order_items oi JOIN orders o ON oi.order_id = o.id JOIN products p ON oi.product_id = p.id WHERE o.status = 'delivered' LIMIT 5`);
    console.log(orderData.rows);

    if (orderData.rows.length === 0) {
      console.warn('No delivered order items found');
      process.exit(0);
    }

    const sample = orderData.rows[0];
    console.log('\n=== Sample order item ===');
    console.log(sample);

    const reviewSchemaInfo = await detectReviewSchemaInfo((sql) => query(sql));
    console.log('\n=== Detected review schema info ===');
    console.log(reviewSchemaInfo);

    const reviewText = 'This is a test review with image.';
    const reviewImagesJson = ['https://res.cloudinary.com/demo/image/upload/v123456/test.jpg'];

    if (reviewSchemaInfo.hasReviewImages) {
      const insertConfig = buildReviewInsertConfig(
        reviewSchemaInfo,
        'test-review-id-123',
        sample.product_id,
        sample.user_id,
        5,
        'Great',
        reviewText,
        reviewImagesJson
      );
      console.log('\n=== Generated insert query ===');
      console.log(insertConfig.text);
      console.log('Parameters:', insertConfig.params);
    } else {
      console.log('\n=== No review_images column in schema; insert will omit image field ===');
    }

    process.exit(0);
  } catch (err) {
    console.error('Probe error:', err);
    process.exit(1);
  }
})();
