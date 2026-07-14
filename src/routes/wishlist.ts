import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import logger from '../logger';

const router: Router = express.Router();

// Get wishlist
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;

    const result = await query(
      `SELECT wi.id, wi.product_id, p.name, p.price, p.image_url, p.category
       FROM wishlist_items wi
       JOIN products p ON wi.product_id = p.id
       WHERE wi.user_id = $1
       ORDER BY wi.created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    logger.error('Get wishlist error:', error);
    res.status(500).json({ error: 'Failed to fetch wishlist' });
  }
});

// Add to wishlist
router.post('/add', requireAuth, async (req: Request, res: Response) => {
  try {
    const { product_id } = req.body;
    const userId = req.auth?.userId;

    if (!product_id) {
      return res.status(400).json({ error: 'Product ID required' });
    }

    // Check if product exists
    const productResult = await query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check if already in wishlist
    const existingItem = await query(
      'SELECT * FROM wishlist_items WHERE user_id = $1 AND product_id = $2',
      [userId, product_id]
    );

    if (existingItem.rows.length > 0) {
      return res.status(400).json({ error: 'Already in wishlist' });
    }

    const wishlistItemId = uuidv4();
    await query(
      'INSERT INTO wishlist_items (id, user_id, product_id) VALUES ($1, $2, $3)',
      [wishlistItemId, userId, product_id]
    );

    res.status(201).json({ message: 'Item added to wishlist' });
  } catch (error) {
    logger.error('Add to wishlist error:', error);
    res.status(500).json({ error: 'Failed to add to wishlist' });
  }
});

// Remove from wishlist
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.auth?.userId;

    await query('DELETE FROM wishlist_items WHERE id = $1 AND user_id = $2', [id, userId]);

    res.json({ message: 'Item removed from wishlist' });
  } catch (error) {
    logger.error('Remove from wishlist error:', error);
    res.status(500).json({ error: 'Failed to remove from wishlist' });
  }
});

// Check if product is in wishlist
router.get('/check/:product_id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { product_id } = req.params;
    const userId = req.auth?.userId;

    const result = await query(
      'SELECT * FROM wishlist_items WHERE user_id = $1 AND product_id = $2',
      [userId, product_id]
    );

    res.json({ inWishlist: result.rows.length > 0 });
  } catch (error) {
    logger.error('Check wishlist error:', error);
    res.status(500).json({ error: 'Failed to check wishlist' });
  }
});

export default router;
