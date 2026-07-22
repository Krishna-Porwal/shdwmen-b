const { query } = require('./dist/db/connection.js');
const { detectReviewSchemaInfo, buildReviewJoinCondition, buildReviewSelectExpressions } = require('./dist/utils/reviewCompatibility.js');

(async () => {
  const orderId = '663564d5-0180-46dc-80f6-7dddcbabebd9';
  const userId = 'test-user-checkout';
  const reviewSchemaInfo = await detectReviewSchemaInfo((sql) => query(sql));
  const reviewExpressions = buildReviewSelectExpressions(reviewSchemaInfo);
  const reviewJoinCondition = buildReviewJoinCondition(reviewSchemaInfo, '$2');
  const sql = `SELECT o.*,
      (
        SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'quantity', oi.quantity,
          'price', oi.price,
          'product_name', COALESCE((oi.product_snapshot->>'product_name'), p.name),
          'product_image', COALESCE((oi.product_snapshot->>'product_image'), p.image_url),
          'size', oi.product_snapshot->>'size',
          'color', oi.product_snapshot->>'color',
          'snapshot', oi.product_snapshot,
          'review_id', r.id,
          'reviewed', r.id IS NOT NULL,
          'review_rating', r.rating,
          'review_comment', ${reviewExpressions.reviewText},
          'review_title', ${reviewExpressions.reviewTitle},
          'review_images', ${reviewExpressions.reviewImages},
          'review_verified', ${reviewExpressions.verifiedPurchase}
        )) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb)
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        ${reviewJoinCondition}
        WHERE oi.order_id = o.id
      ) as items,
      (
        SELECT COALESCE(MAX(COALESCE(m.shop_name, m.name)), 'SHDWMEN')
        FROM order_items oi2
        JOIN products p2 ON oi2.product_id = p2.id
        LEFT JOIN users m ON p2.merchant_id = m.id
        WHERE oi2.order_id = o.id
      ) as seller_name,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', osh.id,
          'previous_status', osh.previous_status,
          'new_status', osh.new_status,
          'note', osh.note,
          'changed_by', osh.changed_by,
          'changed_by_role', osh.changed_by_role,
          'created_at', osh.created_at
        )) FILTER (WHERE osh.id IS NOT NULL), '[]'::jsonb)
        FROM order_status_history osh WHERE osh.order_id = o.id
      ) as status_history
     FROM orders o
     WHERE o.id = $1 AND o.user_id = $2`;
  const res = await query(sql, [orderId, userId]);
  console.log(JSON.stringify(res.rows[0], null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
