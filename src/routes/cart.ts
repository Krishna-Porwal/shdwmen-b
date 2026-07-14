import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import logger from '../logger';

const router: Router = express.Router();

interface AddToCartRequest {
  product_id: string;
  quantity: number;
}

// Get cart items
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;

    const result = await query(
      `SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price, p.image_url, (p.price * ci.quantity) as total
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    logger.error('Get cart error:', error);
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

// Add to cart
router.post('/add', requireAuth, async (req: Request<{}, {}, AddToCartRequest>, res: Response) => {
  try {
    const { product_id, quantity } = req.body;
    const userId = req.auth?.userId;

    if (!product_id || !quantity) {
      return res.status(400).json({ error: 'Product ID and quantity required' });
    }

    // Check if product exists
    const productResult = await query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check if already in cart
    const existingItem = await query(
      'SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2',
      [userId, product_id]
    );

    if (existingItem.rows.length > 0) {
      // Update quantity
      await query(
        'UPDATE cart_items SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND product_id = $3',
        [quantity, userId, product_id]
      );
    } else {
      // Add new item
      const cartItemId = uuidv4();
      await query(
        'INSERT INTO cart_items (id, user_id, product_id, quantity) VALUES ($1, $2, $3, $4)',
        [cartItemId, userId, product_id, quantity]
      );
    }

    res.json({ message: 'Item added to cart' });
  } catch (error) {
    logger.error('Add to cart error:', error);
    res.status(500).json({ error: 'Failed to add to cart' });
  }
});

// Update cart item quantity
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    const userId = req.auth?.userId;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }

    await query(
      'UPDATE cart_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
      [quantity, id, userId]
    );

    res.json({ message: 'Cart item updated' });
  } catch (error) {
    logger.error('Update cart error:', error);
    res.status(500).json({ error: 'Failed to update cart' });
  }
});

// Remove from cart
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.auth?.userId;

    await query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [id, userId]);

    res.json({ message: 'Item removed from cart' });
  } catch (error) {
    logger.error('Remove from cart error:', error);
    res.status(500).json({ error: 'Failed to remove from cart' });
  }
});

// Clear cart
router.post('/clear', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;

    await query('DELETE FROM cart_items WHERE user_id = $1', [userId]);

    res.json({ message: 'Cart cleared' });
  } catch (error) {
    logger.error('Clear cart error:', error);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

export default router;
