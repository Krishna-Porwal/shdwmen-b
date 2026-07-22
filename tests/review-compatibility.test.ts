import {
  buildReviewJoinCondition,
  buildReviewSelectExpressions,
  buildReviewInsertConfig,
  type ReviewSchemaInfo,
} from '../src/utils/reviewCompatibility';

describe('review schema compatibility helpers', () => {
  it('builds a fallback join and select expressions for the older schema', () => {
    const info: ReviewSchemaInfo = {
      hasTitle: false,
      hasReview: false,
      hasComment: true,
      hasReviewImages: false,
      hasIsVerifiedPurchase: false,
      hasUpdatedAt: true,
    };

    expect(buildReviewJoinCondition(info, '$2')).toBe('LEFT JOIN reviews r ON r.product_id = oi.product_id AND r.user_id = $2');
    expect(buildReviewSelectExpressions(info)).toEqual({
      reviewText: "COALESCE(r.comment, '')",
      reviewTitle: "''",
      reviewImages: "'[]'::jsonb",
      verifiedPurchase: 'TRUE',
    });
  });

  it('builds an insert payload using the existing review columns', () => {
    const info: ReviewSchemaInfo = {
      hasTitle: true,
      hasReview: true,
      hasComment: false,
      hasReviewImages: true,
      hasIsVerifiedPurchase: true,
      hasUpdatedAt: true,
    };

    const insertConfig = buildReviewInsertConfig(info, 'review-id', 'product-id', 'user-id', 5, 'Title', 'Great product', []);

    expect(insertConfig.text).toContain('INSERT INTO reviews');
    expect(insertConfig.text).toContain('review_images');
    expect(insertConfig.params).toEqual([
      'review-id',
      'product-id',
      'user-id',
      5,
      'Great product',
      'Title',
      '[]',
      true,
    ]);
  });
});
