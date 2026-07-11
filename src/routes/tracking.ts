import express, { Router, Request, Response } from 'express';
import { query } from '../db/connection';

const router: Router = express.Router();

interface TrackingRequest {
  productId: string;
  activityType: 'view' | 'click' | 'add_to_cart' | 'add_to_wishlist' | 'search';
  userId?: string;
}

/**
 * Track user activity for analytics
 * POST /api/tracking/activity
 * Tracks: views, clicks, cart adds, wishlist adds, searches
 */
router.post('/activity', async (req: Request<{}, {}, TrackingRequest>, res: Response) => {
  try {
    const { productId, activityType, userId } = req.body;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!productId || !activityType) {
      return res.status(400).json({ error: 'Product ID and activity type required' });
    }

    // Insert tracking record
    await query(
      `INSERT INTO user_activity (user_id, product_id, activity_type, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, productId, activityType, String(ipAddress), userAgent]
    );

    res.status(201).json({ message: 'Activity tracked' });
  } catch (error) {
    console.error('Track activity error:', error);
    res.status(500).json({ error: 'Failed to track activity' });
  }
});

/**
 * Get product analytics
 * GET /api/tracking/product/:productId
 */
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;

    const result = await query(
      `SELECT 
        activity_type, 
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT ip_address) as unique_ips
       FROM user_activity
       WHERE product_id = $1
       GROUP BY activity_type`,
      [productId]
    );

    res.json({
      productId,
      activities: result.rows,
    });
  } catch (error) {
    console.error('Get product analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * Get user activity history
 * GET /api/tracking/user/:userId
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const result = await query(
      `SELECT ua.*, p.name as product_name, p.image_url
       FROM user_activity ua
       LEFT JOIN products p ON ua.product_id = p.id
       WHERE ua.user_id = $1
       ORDER BY ua.created_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json({
      userId,
      activities: result.rows,
    });
  } catch (error) {
    console.error('Get user activity error:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
  }
});

export default router;
