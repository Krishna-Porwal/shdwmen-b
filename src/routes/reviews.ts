import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/connection';
import { ensureUserExists, requireAuth, requireMerchant } from '../middleware/auth';
import { detectReviewSchemaInfo, buildReviewInsertConfig } from '../utils/reviewCompatibility';
import logger from '../logger';

const router: Router = express.Router();

interface CreateReviewRequest {
  orderItemId: string;
  productId: string;
  rating: number;
  comment?: string;
  review?: string;
  title?: string;
  review_images?: string[];
}

/**
 * Create/update a review for a product
 * POST /api/reviews
 */
router.post('/', requireAuth, async (req: Request<{}, {}, CreateReviewRequest>, res: Response) => {
  try {
    const userId = req.auth?.userId;
    const { orderItemId, productId, rating, comment, review, title, review_images } = req.body;
    const reviewText = String(review || comment || '').trim();

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await ensureUserExists(userId, req.auth?.email, req.auth?.email);

    if (!orderItemId || !productId || typeof rating !== 'number') {
      return res.status(400).json({ error: 'Order item, product and rating are required' });
    }

    if (reviewText.length > 1000) {
      return res.status(400).json({ error: 'Review text must be 1000 characters or less' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const reviewImagesJson = Array.isArray(review_images)
      ? review_images.filter((img) => typeof img === 'string')
      : [];

    const hasReviewText = reviewText.length > 0;
    const hasReviewImages = reviewImagesJson.length > 0;

    if (hasReviewText && !hasReviewImages) {
      return res.status(400).json({ error: 'Review text requires at least one uploaded image.' });
    }

    if (hasReviewImages && !hasReviewText) {
      return res.status(400).json({ error: 'Uploaded images require review text.' });
    }

    const orderItemResult = await query(
      `SELECT oi.id,
        oi.product_id,
        o.id AS order_id,
        o.status,
        p.merchant_id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE oi.id = $1 AND oi.product_id = $2 AND o.user_id = $3
       LIMIT 1`,
      [orderItemId, productId, userId]
    );

    if (orderItemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order item not found for this user' });
    }

    const orderItem = orderItemResult.rows[0];
    if (orderItem.status !== 'delivered') {
      return res.status(400).json({ error: 'Reviews are only allowed after delivery' });
    }

    const merchantId = orderItem.merchant_id;
    if (merchantId) {
      await ensureUserExists(merchantId, undefined, 'Merchant');
    }

    const reviewSchemaInfo = await detectReviewSchemaInfo((sql: string) => query(sql));

    if (hasReviewImages && !reviewSchemaInfo.hasReviewImages) {
      return res.status(400).json({ error: 'Review image uploads are not supported by the current database schema.' });
    }

    const existingReview = await query(
      'SELECT * FROM reviews WHERE product_id = $1 AND user_id = $2',
      [productId, userId]
    );

    let reviewId = existingReview.rows[0]?.id;
    if (existingReview.rows.length > 0) {
      const updateColumns: string[] = ['rating = $1'];
      const updateParams: any[] = [rating];
      let nextParam = 2;

      if (reviewSchemaInfo.hasTitle) {
        updateColumns.push(`title = $${nextParam}`);
        updateParams.push(title || null);
        nextParam += 1;
      }

      if (reviewSchemaInfo.hasReview) {
        updateColumns.push(`review = $${nextParam}`);
        updateParams.push(reviewText);
        nextParam += 1;
      } else if (reviewSchemaInfo.hasComment) {
        updateColumns.push(`comment = $${nextParam}`);
        updateParams.push(reviewText);
        nextParam += 1;
      }

      if (reviewSchemaInfo.hasReviewImages) {
        updateColumns.push(`review_images = $${nextParam}::jsonb`);
        updateParams.push(JSON.stringify(reviewImagesJson));
        nextParam += 1;
      }

      if (reviewSchemaInfo.hasUpdatedAt) {
        updateColumns.push('updated_at = CURRENT_TIMESTAMP');
      }

      updateParams.push(reviewId);
      await query(
        `UPDATE reviews SET ${updateColumns.join(', ')} WHERE id = $${nextParam}`,
        updateParams
      );
    } else {
      reviewId = uuidv4();
      const insertConfig = buildReviewInsertConfig(
        reviewSchemaInfo,
        reviewId,
        productId,
        userId,
        rating,
        title || null,
        reviewText,
        reviewImagesJson
      );
      await query(insertConfig.text, insertConfig.params as any[]);
    }

    const avgResult = await query(
      `SELECT COUNT(*) as total, AVG(rating) as avg_rating
       FROM reviews WHERE product_id = $1`,
      [productId]
    );

    const totalReviews = parseInt(avgResult.rows[0].total, 10) || 0;
    const averageRating = parseFloat(avgResult.rows[0].avg_rating) || 0;

    await query(
      `UPDATE products
       SET avg_rating = $1, review_count = $2
       WHERE id = $3`,
      [Number(averageRating.toFixed(2)), totalReviews, productId]
    );

    res.status(201).json({
      message: 'Review saved',
      reviewId,
      review: reviewText,
      rating,
      totalReviews,
      averageRating,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, 'Save review error');
    res.status(500).json({ error: 'Failed to save review', details: detail });
  }
});

/**
 * Get reviews for a product
 * GET /api/reviews/product/:productId
 */
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;

    const reviewSchemaInfo = await detectReviewSchemaInfo((sql: string) => query(sql));
    const reviewTextColumn = reviewSchemaInfo.hasReview ? 'r.review' : reviewSchemaInfo.hasComment ? 'r.comment' : "''";
    const reviewTitleColumn = reviewSchemaInfo.hasTitle ? 'r.title' : "''";
    const reviewImagesColumn = reviewSchemaInfo.hasReviewImages ? 'r.review_images' : "'[]'::jsonb";
    const verifiedPurchaseColumn = reviewSchemaInfo.hasIsVerifiedPurchase ? 'r.is_verified_purchase' : 'TRUE';
    const reviewUserNameColumn = `COALESCE(NULLIF(CASE WHEN u.name ~ '^(user_|merchant_)[A-Za-z0-9]+$' THEN NULL ELSE u.name END, ''), 'Anonymous Customer')`;

    const result = await query(
      `SELECT r.id, r.rating, ${reviewTitleColumn} as title, ${reviewTextColumn} as comment, ${reviewImagesColumn} as "reviewImages", ${verifiedPurchaseColumn} as "isVerifiedPurchase",
              r.created_at as "createdAt", ${reviewUserNameColumn} as "userName", u.email as "userEmail"
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC`,
      [productId]
    );

    const avgResult = await query(
      `SELECT COUNT(*) as total, AVG(rating) as avg_rating
       FROM reviews WHERE product_id = $1`,
      [productId]
    );

    res.json({
      productId,
      reviews: result.rows,
      totalReviews: parseInt(avgResult.rows[0].total, 10) || 0,
      averageRating: parseFloat(avgResult.rows[0].avg_rating) || 0,
    });
  } catch (error) {
    logger.error('Get reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

/**
 * Delete a review
 * DELETE /api/reviews/:reviewId
 */
router.get('/merchant', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const reviewSchemaInfo = await detectReviewSchemaInfo((sql: string) => query(sql));
    const reviewTextColumn = reviewSchemaInfo.hasReview ? 'r.review' : reviewSchemaInfo.hasComment ? 'r.comment' : "''";
    const reviewTitleColumn = reviewSchemaInfo.hasTitle ? 'r.title' : "''";
    const reviewImagesColumn = reviewSchemaInfo.hasReviewImages ? 'r.review_images' : "'[]'::jsonb";
    const verifiedPurchaseColumn = reviewSchemaInfo.hasIsVerifiedPurchase ? 'r.is_verified_purchase' : 'TRUE';
    const reviewUserNameColumn = `COALESCE(NULLIF(CASE WHEN u.name ~ '^(user_|merchant_)[A-Za-z0-9]+$' THEN NULL ELSE u.name END, ''), 'Anonymous Customer')`;
    // Older schema may not have merchant_id on reviews; join products and filter by product merchant
    const result = await query(
      `SELECT r.id, r.rating, ${reviewTitleColumn} as title, ${reviewTextColumn} as comment, ${reviewImagesColumn} as "reviewImages", ${verifiedPurchaseColumn} as "isVerifiedPurchase",
              r.created_at as "createdAt", r.product_id as "productId", ${reviewUserNameColumn} as "userName", u.email as "userEmail"
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN products p ON r.product_id = p.id
       WHERE p.merchant_id = $1
       ORDER BY r.created_at DESC`,
      [merchantId]
    );

    res.json({ reviews: result.rows });
  } catch (error) {
    logger.error('Merchant reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch merchant reviews' });
  }
});

router.post('/:reviewId/reply', requireMerchant, async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const { message } = req.body as { message?: string };
    const merchantId = req.auth?.userId;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Reply message is required' });
    }

    const reviewResult = await query('SELECT id FROM reviews WHERE id = $1 AND merchant_id = $2', [reviewId, merchantId]);
    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    await query(
      `INSERT INTO review_replies (id, review_id, merchant_id, message) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), reviewId, merchantId, message.trim()]
    );

    res.json({ message: 'Reply saved' });
  } catch (error) {
    logger.error('Reply review error:', error);
    res.status(500).json({ error: 'Failed to save reply' });
  }
});

router.patch('/:reviewId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const userId = req.auth?.userId;
    const { rating, title, review, review_images } = req.body as { rating?: number; title?: string; review?: string; review_images?: string[] };
    const reviewText = String(review || '').trim();

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!rating && rating !== 0) {
      return res.status(400).json({ error: 'Rating is required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    if (reviewText.length < 20 || reviewText.length > 1000) {
      return res.status(400).json({ error: 'Review text must be between 20 and 1000 characters' });
    }

    const reviewResult = await query('SELECT * FROM reviews WHERE id = $1 AND user_id = $2', [reviewId, userId]);
    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const reviewSchemaInfo = await detectReviewSchemaInfo((sql: string) => query(sql));

    const reviewImagesJson = Array.isArray(review_images)
      ? review_images.filter((img) => typeof img === 'string')
      : [];

    // Build dynamic update clause based on available columns
    const updateColumns: string[] = [];
    const params: any[] = [];

    // rating is required and will be first parameter
    params.push(rating);
    updateColumns.push('rating = $1');

    let paramIndex = params.length + 1; // next placeholder index

    if (reviewSchemaInfo.hasTitle) {
      updateColumns.push(`title = $${paramIndex}`);
      params.push(title || null);
      paramIndex += 1;
    }

    if (reviewSchemaInfo.hasReview) {
      updateColumns.push(`review = $${paramIndex}`);
      params.push(reviewText);
      paramIndex += 1;
    } else if (reviewSchemaInfo.hasComment) {
      updateColumns.push(`comment = $${paramIndex}`);
      params.push(reviewText);
      paramIndex += 1;
    }

    if (reviewSchemaInfo.hasReviewImages) {
      updateColumns.push(`review_images = $${paramIndex}::jsonb`);
      params.push(JSON.stringify(reviewImagesJson));
      paramIndex += 1;
    }

    if (reviewSchemaInfo.hasUpdatedAt) {
      updateColumns.push('updated_at = CURRENT_TIMESTAMP');
    }

    // Ensure we update only the user's review by adding id and user_id to params
    const idParamIndex = paramIndex;
    params.push(reviewId);
    const userParamIndex = paramIndex + 1;
    params.push(userId);

    const setClause = updateColumns.length > 0 ? updateColumns.join(', ') : '';
    const sql = `UPDATE reviews SET ${setClause} WHERE id = $${idParamIndex} AND user_id = $${userParamIndex}`;

    await query(sql, params);

    res.json({ message: 'Review updated' });
  } catch (error) {
    logger.error('Update review error:', error);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

router.delete('/:reviewId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const userId = req.auth?.userId;

    const reviewResult = await query(
      'SELECT * FROM reviews WHERE id = $1 AND user_id = $2',
      [reviewId, userId]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const productId = reviewResult.rows[0].product_id;

    await query('DELETE FROM reviews WHERE id = $1', [reviewId]);

    const avgResult = await query(
      'SELECT COUNT(*) as total, AVG(rating) as avg_rating FROM reviews WHERE product_id = $1',
      [productId]
    );

    const totalReviews = parseInt(avgResult.rows[0].total, 10) || 0;
    const averageRating = parseFloat(avgResult.rows[0].avg_rating) || 0;

    await query(
      `UPDATE products
       SET avg_rating = $1, review_count = $2
       WHERE id = $3`,
      [Number(averageRating.toFixed(2)), totalReviews, productId]
    );

    res.json({ message: 'Review deleted' });
  } catch (error) {
    logger.error('Delete review error:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

export default router;
