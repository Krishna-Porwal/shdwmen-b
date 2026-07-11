import express, { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';

const router: Router = express.Router();

/**
 * Create/update a review for a product
 * POST /api/reviews
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;
    const { productId, rating, comment } = req.body;

    if (!productId || !rating) {
      return res.status(400).json({ error: 'Product ID and rating required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Check if user already reviewed this product
    const existingReview = await query(
      'SELECT * FROM reviews WHERE product_id = $1 AND user_id = $2',
      [productId, userId]
    );

    let reviewId: string;

    if (existingReview.rows.length > 0) {
      // Update existing review
      reviewId = existingReview.rows[0].id;
      await query(
        'UPDATE reviews SET rating = $1, comment = $2 WHERE id = $3',
        [rating, comment || null, reviewId]
      );
    } else {
      // Create new review
      const { v4: uuidv4 } = await import('uuid');
      reviewId = uuidv4();
      await query(
        'INSERT INTO reviews (id, product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4, $5)',
        [reviewId, productId, userId, rating, comment || null]
      );
    }

    // Recalculate product average rating
    const avgResult = await query(
      'SELECT AVG(rating) as avg_rating FROM reviews WHERE product_id = $1',
      [productId]
    );

    const avgRating = parseFloat(avgResult.rows[0].avg_rating) || 0;

    // Update product avg_rating
    await query(
      'UPDATE products SET avg_rating = $1 WHERE id = $2',
      [avgRating.toFixed(2), productId]
    );

    res.status(201).json({
      message: 'Review saved',
      reviewId,
      productAverageRating: avgRating,
    });
  } catch (error) {
    console.error('Save review error:', error);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

/**
 * Get reviews for a product
 * GET /api/reviews/product/:productId
 */
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;

    const result = await query(
      `SELECT r.*, u.name as user_name
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC`,
      [productId]
    );

    // Get average rating
    const avgResult = await query(
      `SELECT COUNT(*) as total, AVG(rating) as avg_rating
       FROM reviews WHERE product_id = $1`,
      [productId]
    );

    res.json({
      productId,
      reviews: result.rows,
      totalReviews: parseInt(avgResult.rows[0].total),
      averageRating: parseFloat(avgResult.rows[0].avg_rating) || 0,
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

/**
 * Delete a review
 * DELETE /api/reviews/:reviewId
 */
router.delete('/:reviewId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const userId = req.auth?.userId;

    // Check if user owns the review
    const reviewResult = await query(
      'SELECT * FROM reviews WHERE id = $1 AND user_id = $2',
      [reviewId, userId]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const productId = reviewResult.rows[0].product_id;

    // Delete review
    await query('DELETE FROM reviews WHERE id = $1', [reviewId]);

    // Recalculate average rating
    const avgResult = await query(
      'SELECT AVG(rating) as avg_rating FROM reviews WHERE product_id = $1',
      [productId]
    );

    const avgRating = parseFloat(avgResult.rows[0].avg_rating) || 0;

    // Update product avg_rating
    await query(
      'UPDATE products SET avg_rating = $1 WHERE id = $2',
      [avgRating.toFixed(2), productId]
    );

    res.json({ message: 'Review deleted' });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

export default router;
