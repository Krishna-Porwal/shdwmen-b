export interface ReviewSchemaInfo {
  hasTitle: boolean;
  hasReview: boolean;
  hasComment: boolean;
  hasReviewImages: boolean;
  hasIsVerifiedPurchase: boolean;
  hasUpdatedAt: boolean;
}

export async function detectReviewSchemaInfo(query: (sql: string) => Promise<{ rows: Array<{ column_name: string }> }>): Promise<ReviewSchemaInfo> {
  const columns = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews'
    ORDER BY ordinal_position
  `);

  const names = new Set(columns.rows.map((row) => row.column_name));

  return {
    hasTitle: names.has('title'),
    hasReview: names.has('review'),
    hasComment: names.has('comment'),
    hasReviewImages: names.has('review_images'),
    hasIsVerifiedPurchase: names.has('is_verified_purchase'),
    hasUpdatedAt: names.has('updated_at'),
  };
}

export function buildReviewJoinCondition(_info: ReviewSchemaInfo, userParam: string): string {
  return `LEFT JOIN reviews r ON r.product_id = oi.product_id AND r.user_id = ${userParam}`;
}

export function buildReviewSelectExpressions(info: ReviewSchemaInfo) {
  return {
    reviewText: info.hasReview ? 'COALESCE(r.review, \'\')' : info.hasComment ? "COALESCE(r.comment, '')" : "''",
    reviewTitle: info.hasTitle ? 'COALESCE(r.title, \'\')' : "''",
    reviewImages: info.hasReviewImages ? "COALESCE(r.review_images, '[]'::jsonb)" : "'[]'::jsonb",
    verifiedPurchase: info.hasIsVerifiedPurchase ? 'COALESCE(r.is_verified_purchase, TRUE)' : 'TRUE',
  };
}

export function buildReviewInsertConfig(
  info: ReviewSchemaInfo,
  reviewId: string,
  productId: string,
  userId: string,
  rating: number,
  title: string | null,
  reviewText: string,
  reviewImagesJson: string[]
) {
  const reviewImages = JSON.stringify(reviewImagesJson);
  const columns: string[] = ['id', 'product_id', 'user_id', 'rating'];
  const params: unknown[] = [reviewId, productId, userId, rating];

  if (info.hasReview) {
    columns.push('review');
    params.push(reviewText);
  } else if (info.hasComment) {
    columns.push('comment');
    params.push(reviewText);
  }

  if (info.hasTitle) {
    columns.push('title');
    params.push(title || null);
  }

  if (info.hasReviewImages) {
    columns.push('review_images');
    params.push(reviewImages);
  }

  if (info.hasIsVerifiedPurchase) {
    columns.push('is_verified_purchase');
    params.push(true);
  }

  const placeholders = columns.map((col, index) => {
    const idx = index + 1;
    if (col === 'review_images') return `$${idx}::jsonb`;
    return `$${idx}`;
  }).join(', ');

  return {
    text: `INSERT INTO reviews (${columns.join(', ')}) VALUES (${placeholders})`,
    params,
  };
}
