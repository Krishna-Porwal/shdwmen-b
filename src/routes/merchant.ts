import express, { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { requireAuth, requireMerchant } from '../middleware/auth';
import { isMissingRelationError } from '../utils/apiError';
import { sendServerError } from '../utils/apiError';

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
    sendServerError(res, error, 'Failed to save merchant profile');
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
    sendServerError(res, error, 'Failed to fetch merchant profile');
  }
});

// Get merchant dashboard data
router.get('/dashboard', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    console.log('[MERCHANT][DASHBOARD] merchantId=', merchantId);
    const totalProductsResult = await query(
      `SELECT COUNT(*) as count
       FROM products
       WHERE merchant_id = $1
         AND status != 'inactive'`,
      [merchantId]
    );
    const totalProducts = parseInt(totalProductsResult.rows[0].count, 10) || 0;

    const ordersResult = await query(
      `WITH merchant_orders AS (
         SELECT DISTINCT o.id, o.total_amount, o.status, o.payment_method, o.created_at, o.shipping_address, o.address_snapshot,
                u.name as customer_name, u.email as customer_email
         FROM orders o
         JOIN users u ON o.user_id = u.id
         WHERE EXISTS (
           SELECT 1
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id AND p.merchant_id = $1
         )
       )
       SELECT *
       FROM merchant_orders
       ORDER BY created_at DESC`,
      [merchantId]
    );

    const allOrders = ordersResult.rows;
    console.log('[MERCHANT][DASHBOARD] orderRows=', allOrders.length);
    const totalOrders = allOrders.length;
    const onlineOrders = allOrders.filter((order) => order.payment_method === 'razorpay').length;
    const codOrders = allOrders.filter((order) => order.payment_method === 'cod').length;
    const deliveredOrders = allOrders.filter((order) => order.status === 'delivered').length;
    const cancelledOrders = allOrders.filter((order) => order.status === 'cancelled').length;
    const totalRevenue = allOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    const onlineRevenue = allOrders.filter((order) => order.payment_method === 'razorpay').reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    const pendingCodAmount = allOrders.filter((order) => order.payment_method === 'cod' && order.status === 'pending').reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

    const totalItemsResult = await query(
      `SELECT COALESCE(SUM(oi.quantity), 0) as total_items
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE p.merchant_id = $1`,
      [merchantId]
    );
    const totalItems = parseInt(totalItemsResult.rows[0].total_items, 10) || 0;

    const recentOrdersResult = await query(
      `SELECT o.id, o.total_amount, o.status, o.payment_method, o.created_at, u.name as customer_name, u.email as customer_email,
              COALESCE(json_agg(
                json_build_object(
                  'id', oi.id,
                  'product_id', oi.product_id,
                  'quantity', oi.quantity,
                  'price', oi.price,
                  'product_name', COALESCE(oi.product_snapshot->>'product_name', p.name),
                  'product_image', COALESCE(oi.product_snapshot->>'product_image', p.image_url),
                  'size', oi.product_snapshot->>'size',
                  'color', oi.product_snapshot->>'color'
                )
              ) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       JOIN users u ON o.user_id = u.id
       WHERE p.merchant_id = $1
       GROUP BY o.id, u.name, u.email
       ORDER BY o.created_at DESC
       LIMIT 10`,
      [merchantId]
    );

    const lowStockResult = await query(
      `SELECT id, name, stock, image_url, imgs
       FROM products
       WHERE merchant_id = $1 AND stock <= 5
       ORDER BY stock ASC, updated_at DESC`,
      [merchantId]
    );

    const topProductsResult = await query(
      `SELECT p.id, p.name, p.image_url, p.imgs, SUM(oi.quantity) as units_sold, SUM(oi.quantity * oi.price) as revenue
       FROM products p
       JOIN order_items oi ON p.id = oi.product_id
       JOIN orders o ON oi.order_id = o.id
       WHERE p.merchant_id = $1
       GROUP BY p.id, p.name, p.image_url, p.imgs
       ORDER BY revenue DESC
       LIMIT 10`,
      [merchantId]
    );

    const sevenDaysResult = await query(
      `WITH merchant_orders AS (
         SELECT DISTINCT o.id, o.total_amount, o.created_at
         FROM orders o
         WHERE EXISTS (
           SELECT 1
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id AND p.merchant_id = $1
         )
       )
       SELECT DATE(created_at) as day, COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as orders
       FROM merchant_orders
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [merchantId]
    );

    const thirtyDaysResult = await query(
      `WITH merchant_orders AS (
         SELECT DISTINCT o.id, o.total_amount, o.created_at
         FROM orders o
         WHERE EXISTS (
           SELECT 1
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id AND p.merchant_id = $1
         )
       )
       SELECT DATE(created_at) as day, COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as orders
       FROM merchant_orders
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [merchantId]
    );

    res.json({
      totalProducts,
      totalOrders,
      totalItems,
      totalRevenue,
      onlineRevenue,
      onlineOrders,
      codOrders,
      pendingCodAmount,
      deliveredOrders,
      cancelledOrders,
      topSellingProducts: topProductsResult.rows,
      salesLast7Days: sevenDaysResult.rows,
      salesLast30Days: thirtyDaysResult.rows,
      lowStockAlerts: lowStockResult.rows,
      recentOrders: recentOrdersResult.rows,
    });
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch dashboard data');
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
    sendServerError(res, error, 'Failed to fetch products');
  }
});

// Get merchant orders
router.get('/orders', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    console.log('[MERCHANT][ORDERS] merchantId=', merchantId, 'query=', req.query);

    const status = req.query.status ? String(req.query.status).toLowerCase() : '';
    const paymentMethod = req.query.payment_method ? String(req.query.payment_method).toLowerCase() : '';
    const search = req.query.search ? String(req.query.search).toLowerCase().trim() : '';
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const result = await query(
      `SELECT o.id, o.total_amount, o.status, o.payment_method, o.created_at, o.shipping_address, o.address_snapshot,
              u.name as customer_name, u.email as customer_email,
              COALESCE(json_agg(
                json_build_object(
                  'id', oi.id,
                  'product_id', oi.product_id,
                  'quantity', oi.quantity,
                  'price', oi.price,
                  'product_name', COALESCE(oi.product_snapshot->>'product_name', p.name),
                  'product_image', COALESCE(oi.product_snapshot->>'product_image', p.image_url),
                  'size', oi.product_snapshot->>'size',
                  'color', oi.product_snapshot->>'color'
                )
              ) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       JOIN users u ON o.user_id = u.id
       WHERE p.merchant_id = $1
       ${status ? 'AND o.status = $2' : ''}
       ${paymentMethod ? `AND o.payment_method = $${status ? 3 : 2}` : ''}
       ${from ? `AND o.created_at >= $${(status ? 1 : 0) + (paymentMethod ? 1 : 0) + 2}` : ''}
       ${to ? `AND o.created_at <= $${(status ? 1 : 0) + (paymentMethod ? 1 : 0) + (from ? 1 : 0) + 2}` : ''}
       GROUP BY o.id, u.name, u.email, o.shipping_address, o.address_snapshot
       ORDER BY o.created_at DESC`,
      [
        merchantId,
        ...(status ? [status] : []),
        ...(paymentMethod ? [paymentMethod] : []),
        ...(from ? [from.toISOString()] : []),
        ...(to ? [to.toISOString()] : []),
      ]
    );

    console.log('[MERCHANT][ORDERS] resultRows=', result.rows.length);
    const filteredOrders = search
      ? result.rows.filter((order: any) => JSON.stringify(order).toLowerCase().includes(search))
      : result.rows;

    console.log('[MERCHANT][ORDERS] returnedRows=', filteredOrders.length);
    res.json(filteredOrders);
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch orders');
  }
});

// Get order details for merchant
router.get('/orders/:id', requireMerchant, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const merchantId = req.auth?.userId;

    const result = await query(
      `SELECT o.*, u.name as customer_name, u.email as customer_email,
              COALESCE(json_agg(
                json_build_object(
                  'id', oi.id,
                  'product_id', oi.product_id,
                  'quantity', oi.quantity,
                  'price', oi.price,
                  'product_name', COALESCE(oi.product_snapshot->>'product_name', p.name),
                  'product_image', COALESCE(oi.product_snapshot->>'product_image', p.image_url),
                  'size', oi.product_snapshot->>'size',
                  'color', oi.product_snapshot->>'color',
                  'snapshot', oi.product_snapshot
                )
              ) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
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
    sendServerError(res, error, 'Failed to fetch order details');
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
    sendServerError(res, error, 'Failed to fetch analytics');
  }
});

// Generic merchant analytics endpoints (total orders, revenue, online revenue, COD, cancelled orders)
router.get('/analytics/total-orders', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const page = parseInt(String(req.query.page || '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize || '20'), 10) || 20;
    const search = req.query.search ? String(req.query.search).toLowerCase().trim() : '';
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const exportCsv = String(req.query.export || '').toLowerCase() === 'csv';

    const params: any[] = [merchantId];
    let whereClauses = `WHERE EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.merchant_id = $1)`;
    let idx = 2;
    if (from) {
      whereClauses += ` AND o.created_at >= $${idx}`;
      params.push(from.toISOString());
      idx++;
    }
    if (to) {
      whereClauses += ` AND o.created_at <= $${idx}`;
      params.push(to.toISOString());
      idx++;
    }

    const baseQuery = `SELECT DISTINCT o.id, o.total_amount, o.status, o.payment_method, o.created_at, o.user_id FROM orders o ${whereClauses}`;

    const countRes = await query(`SELECT COUNT(*) FROM (${baseQuery}) t`, params);
    const total = parseInt(countRes.rows[0].count, 10) || 0;

    const pagedRes = await query(`${baseQuery} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, pageSize, (page - 1) * pageSize]);

    let rows = pagedRes.rows;
    if (search) {
      rows = rows.filter((r: any) => JSON.stringify(r).toLowerCase().includes(search));
    }

    // simple daily aggregation for charting
    const aggRes = await query(`SELECT DATE(o.created_at) as day, COUNT(DISTINCT o.id) as orders FROM orders o ${whereClauses} GROUP BY DATE(o.created_at) ORDER BY day ASC`, params);

    if (exportCsv) {
      const csvRows = [['id', 'total_amount', 'status', 'payment_method', 'created_at'], ...rows.map((r: any) => [r.id, r.total_amount, r.status, r.payment_method, r.created_at])];
      const csv = csvRows.map((r: any[]) => r.map((c) => `"${String(c ?? '')}"`).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="total_orders.csv"');
      return res.send(csv);
    }

    res.json({ total, page, pageSize, data: rows, daily: aggRes.rows });
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch total orders analytics');
  }
});

router.get('/analytics/revenue', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const params: any[] = [merchantId];
    let whereClauses = `WHERE EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.merchant_id = $1)`;
    let idx = 2;
    if (from) {
      whereClauses += ` AND o.created_at >= $${idx}`;
      params.push(from.toISOString());
      idx++;
    }
    if (to) {
      whereClauses += ` AND o.created_at <= $${idx}`;
      params.push(to.toISOString());
      idx++;
    }

    const resRow = await query(`SELECT COALESCE(SUM(o.total_amount),0) as total_revenue, COALESCE(SUM(CASE WHEN o.payment_method='razorpay' THEN o.total_amount ELSE 0 END),0) as online_revenue, COALESCE(SUM(CASE WHEN o.payment_method='cod' THEN o.total_amount ELSE 0 END),0) as cod_revenue FROM orders o ${whereClauses}`, params);
    const timeseries = await query(`SELECT DATE(o.created_at) as day, COALESCE(SUM(o.total_amount),0) as revenue FROM orders o ${whereClauses} GROUP BY DATE(o.created_at) ORDER BY day ASC`, params);

    res.json({ totalRevenue: parseFloat(resRow.rows[0].total_revenue), onlineRevenue: parseFloat(resRow.rows[0].online_revenue), codRevenue: parseFloat(resRow.rows[0].cod_revenue), timeseries: timeseries.rows });
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch revenue analytics');
  }
});

router.get('/analytics/cod', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const page = parseInt(String(req.query.page || '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize || '20'), 10) || 20;
    const params: any[] = [merchantId];
    const base = `SELECT DISTINCT o.id, o.total_amount, o.status, o.created_at FROM orders o WHERE o.payment_method='cod' AND EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.merchant_id = $1)`;
    const countRes = await query(`SELECT COUNT(*) FROM (${base}) t`, params);
    const total = parseInt(countRes.rows[0].count, 10) || 0;
    const paged = await query(`${base} ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [merchantId, pageSize, (page - 1) * pageSize]);
    res.json({ total, page, pageSize, data: paged.rows });
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch COD analytics');
  }
});

router.get('/analytics/cancelled-orders', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const page = parseInt(String(req.query.page || '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize || '20'), 10) || 20;
    const params: any[] = [merchantId];
    const base = `SELECT DISTINCT o.id, o.total_amount, o.status, o.cancel_reason, o.cancel_reason_type, o.cancelled_by, o.cancelled_at, o.created_at FROM orders o WHERE o.status = 'cancelled' AND EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.merchant_id = $1)`;
    const countRes = await query(`SELECT COUNT(*) FROM (${base}) t`, params);
    const total = parseInt(countRes.rows[0].count, 10) || 0;
    const paged = await query(`${base} ORDER BY cancelled_at DESC NULLS LAST LIMIT $2 OFFSET $3`, [merchantId, pageSize, (page - 1) * pageSize]);
    res.json({ total, page, pageSize, data: paged.rows });
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch cancelled orders analytics');
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
    sendServerError(res, error, 'Failed to fetch reviews');
  }
});

// Get dashboard statistics
router.get('/dashboard/stats', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const statsResult = await query(
      `SELECT
         COUNT(DISTINCT o.id) as total_orders,
         COUNT(DISTINCT CASE WHEN o.payment_method = 'razorpay' THEN o.id END) as online_orders,
         COUNT(DISTINCT CASE WHEN o.payment_method = 'cod' THEN o.id END) as cod_orders,
         COALESCE(SUM(CASE WHEN o.payment_method = 'razorpay' THEN o.total_amount ELSE 0 END), 0) as online_revenue,
         COALESCE(SUM(o.total_amount), 0) as total_revenue,
         COUNT(DISTINCT CASE WHEN o.status = 'delivered' THEN o.id END) as delivered_orders,
         COUNT(DISTINCT CASE WHEN o.status = 'cancelled' THEN o.id END) as cancelled_orders,
         COALESCE(SUM(CASE WHEN o.payment_method = 'cod' AND o.status = 'pending' THEN o.total_amount ELSE 0 END), 0) as pending_cod_amount
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE p.merchant_id = $1`,
      [merchantId]
    );

    const lowStockResult = await query(
      `SELECT COUNT(*) as count FROM products WHERE merchant_id = $1 AND stock <= 5`,
      [merchantId]
    );

    const reviewsResult = await query(
      `SELECT COUNT(*) as count FROM reviews r
       JOIN products p ON r.product_id = p.id
       WHERE p.merchant_id = $1`,
      [merchantId]
    );
    let unreadMessages = 0;
    try {
      const messagesResult = await query(
        `SELECT COUNT(*) as count FROM notifications
         WHERE user_id = $1 AND is_read = false`,
        [merchantId]
      );
      unreadMessages = parseInt(messagesResult.rows[0].count, 10) || 0;
    } catch (error) {
      if (!isMissingRelationError(error, 'notifications')) {
        throw error;
      }
    }

    const row = statsResult.rows[0];
    res.json({
      totalOrders: parseInt(row.total_orders, 10) || 0,
      onlineOrders: parseInt(row.online_orders, 10) || 0,
      codOrders: parseInt(row.cod_orders, 10) || 0,
      onlineRevenue: parseFloat(row.online_revenue) || 0,
      totalRevenue: parseFloat(row.total_revenue) || 0,
      deliveredOrders: parseInt(row.delivered_orders, 10) || 0,
      cancelledOrders: parseInt(row.cancelled_orders, 10) || 0,
      pendingCodAmount: parseFloat(row.pending_cod_amount) || 0,
      lowStockAlerts: parseInt(lowStockResult.rows[0].count, 10) || 0,
      reviewsCount: parseInt(reviewsResult.rows[0].count, 10) || 0,
      unreadMessages,
    });
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch dashboard stats');
  }
});

export default router;
