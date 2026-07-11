import express, { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { requireAuth, requireMerchant } from '../middleware/auth';

const router: Router = express.Router();

// Save/update merchant profile
router.post('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    console.log('[MERCHANT] POST /profile request received');
    console.log('[MERCHANT] req.auth:', req.auth);
    console.log('[MERCHANT] Body:', req.body);

    const merchantId = req.auth?.userId;
    const { shopName, ownerName, phone, address, email } = req.body;
    const userEmail = email || `${merchantId}@clerk.local`;

    console.log('[MERCHANT] Extracted - merchantId:', merchantId, 'email from body:', email, 'fallback email:', userEmail);

    if (!merchantId) {
      console.log('[MERCHANT] Missing merchantId - rejecting');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!shopName || !ownerName) {
      console.log('[MERCHANT] Missing required fields');
      return res.status(400).json({ error: 'Shop name and owner name are required' });
    }

    // Ensure there is a user row for this Clerk ID before upgrading to merchant
    const result = await query(
      `INSERT INTO users (id, name, email, password, role)
       VALUES ($1, $2, $3, $4, 'merchant')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         password = EXCLUDED.password,
         role = 'merchant',
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [merchantId, shopName, userEmail, 'clerk_auth']
    );

    if (!result.rows.length) {
      return res.status(500).json({ error: 'Failed to create or update merchant profile' });
    }

    // Update merchant-specific fields
    const updated = await query(
      `UPDATE users 
       SET shop_name = $1, owner_name = $2, phone = $3, address = $4, role = 'merchant', updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [shopName, ownerName, phone || null, address || null, merchantId]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ error: 'Failed to update merchant profile' });
    }

    const userRow = updated.rows[0];

    res.json({
      message: 'Merchant profile saved',
      user: {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        role: userRow.role,
        shopName: userRow.shop_name,
        ownerName: userRow.owner_name,
        phone: userRow.phone,
        address: userRow.address,
      },
    });
  } catch (error) {
    console.error('Save merchant profile error:', error);
    res.status(500).json({ error: 'Failed to save merchant profile' });
  }
});

// Get merchant profile
router.get('/profile', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;

    const result = await query('SELECT * FROM users WHERE id = $1 AND role = $2', [merchantId, 'merchant']);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Merchant profile not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      shopName: user.shop_name,
      ownerName: user.owner_name,
      phone: user.phone,
      address: user.address,
    });
  } catch (error) {
    console.error('Get merchant profile error:', error);
    res.status(500).json({ error: 'Failed to fetch merchant profile' });
  }
});

// Get merchant dashboard data
router.get('/dashboard', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;

    // Get total products
    const productsResult = await query('SELECT COUNT(*) FROM products WHERE merchant_id = $1', [merchantId]);
    const totalProducts = parseInt(productsResult.rows[0].count);

    // Get total sales
    const salesResult = await query(
      `SELECT COUNT(*) as order_count, COALESCE(SUM(oi.quantity), 0) as total_items, COALESCE(SUM(oi.price * oi.quantity), 0) as total_revenue
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE p.merchant_id = $1`,
      [merchantId]
    );

    const sales = salesResult.rows[0];

    // Get recent orders
    const recentOrdersResult = await query(
      `SELECT o.id, o.total_amount, o.status, o.created_at, u.name as customer_name
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       JOIN users u ON o.user_id = u.id
       WHERE p.merchant_id = $1
       GROUP BY o.id, u.name
       ORDER BY o.created_at DESC
       LIMIT 10`,
      [merchantId]
    );

    res.json({
      totalProducts,
      totalOrders: parseInt(sales.order_count),
      totalItems: parseInt(sales.total_items),
      totalRevenue: parseFloat(sales.total_revenue),
      recentOrders: recentOrdersResult.rows,
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get merchant products with analytics
router.get('/products', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;

    const result = await query(
      `SELECT p.*, 
        COUNT(r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as avg_rating,
        COUNT(DISTINCT oi.id) as times_ordered,
        COALESCE(SUM(oi.quantity), 0) as units_sold
       FROM products p
       LEFT JOIN reviews r ON p.id = r.product_id
       LEFT JOIN order_items oi ON p.id = oi.product_id
       WHERE p.merchant_id = $1 AND p.status != 'inactive'
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [merchantId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get merchant products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get merchant orders
router.get('/orders', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;

    const result = await query(
      `SELECT o.id, o.total_amount, o.status, o.created_at, o.shipping_address, u.name as customer_name, u.email as customer_email
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       JOIN users u ON o.user_id = u.id
       WHERE p.merchant_id = $1
       GROUP BY o.id, u.name, u.email, o.shipping_address
       ORDER BY o.created_at DESC`,
      [merchantId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get merchant orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get order details for merchant
router.get('/orders/:id', requireMerchant, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const merchantId = req.auth?.userId;

    const result = await query(
      `SELECT o.*, u.name as customer_name, u.email as customer_email, json_agg(
        json_build_object('id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity, 'price', oi.price, 'product_name', p.name)
      ) as items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       JOIN users u ON o.user_id = u.id
       WHERE o.id = $1 AND p.merchant_id = $2
       GROUP BY o.id, u.name, u.email`,
      [id, merchantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get order details error:', error);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// Get product analytics
router.get('/analytics/products', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;

    const result = await query(
      `SELECT p.name, COUNT(r.id) as total_reviews, COALESCE(AVG(r.rating), 0) as avg_rating, 
              COALESCE(SUM(oi.quantity), 0) as units_sold, COALESCE(SUM(oi.quantity * oi.price), 0) as revenue
       FROM products p
       LEFT JOIN reviews r ON p.id = r.product_id
       LEFT JOIN order_items oi ON p.id = oi.product_id
       WHERE p.merchant_id = $1
       GROUP BY p.id, p.name
       ORDER BY revenue DESC`,
      [merchantId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get product analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get reviews for merchant products
router.get('/reviews', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;

    const result = await query(
      `SELECT r.*, p.name as product_name, u.name as customer_name
       FROM reviews r
       JOIN products p ON r.product_id = p.id
       JOIN users u ON r.user_id = u.id
       WHERE p.merchant_id = $1
       ORDER BY r.created_at DESC`,
      [merchantId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Get dashboard statistics
router.get('/dashboard/stats', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;

    // Get orders for this merchant's products
    const ordersResult = await query(
      `SELECT DISTINCT o.* FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE p.merchant_id = $1`,
      [merchantId]
    );

    // Get total orders and pending orders
    const totalOrders = ordersResult.rows.length;
    const pendingOrders = ordersResult.rows.filter((o: any) => o.status === 'pending').length;

    // Get reviews count
    const reviewsResult = await query(
      `SELECT COUNT(*) as count FROM reviews r
       JOIN products p ON r.product_id = p.id
       WHERE p.merchant_id = $1`,
      [merchantId]
    );
    const reviewsCount = parseInt(reviewsResult.rows[0].count) || 0;

    // Get messages count (unread)
    const messagesResult = await query(
      `SELECT COUNT(*) as count FROM messages
       WHERE receiver_id = $1 AND "read" = false`,
      [merchantId]
    );
    const unreadMessages = parseInt(messagesResult.rows[0].count) || 0;

    res.json({
      totalOrders,
      pendingOrders,
      reviewsCount,
      unreadMessages,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;
