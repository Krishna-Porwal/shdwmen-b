import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import {
  calculateItemSubtotal,
  calculateOrderAmounts,
  checkProductStock,
  validateShippingAddress,
} from '../utils/orderHelpers';

const router: Router = express.Router();

interface OrderItemRequest {
  product_id: string;
  quantity: number;
}

interface ShippingAddress {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pinCode: string;
  paymentMethod: string;
}

interface CreateOrderRequest {
  items: OrderItemRequest[];
  shipping_address?: ShippingAddress;
  payment_method?: string;
}

// Get user orders
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;

    const result = await query(
      `SELECT o.*, o.shipping_address, json_agg(
        json_build_object('id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity, 'price', oi.price, 'product_name', p.name)
      ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.user_id = $1
      GROUP BY o.id, o.shipping_address
      ORDER BY o.created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get order details
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.auth?.userId;

    const result = await query(
      `SELECT o.*, o.shipping_address, json_agg(
        json_build_object('id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity, 'price', oi.price, 'product_name', p.name)
      ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.id = $1 AND o.user_id = $2
      GROUP BY o.id, o.shipping_address`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Create order
router.post('/', requireAuth, async (req: Request<{}, {}, CreateOrderRequest>, res: Response) => {
  try {
    const { items, shipping_address, payment_method } = req.body;
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order items required' });
    }

    const addressValidation = validateShippingAddress(shipping_address);
    if (!addressValidation.valid) {
      return res.status(400).json({ error: 'Invalid shipping address', details: addressValidation.errors });
    }

    for (const item of items) {
      const productAvailable = await checkProductStock(item.product_id, item.quantity);
      if (!productAvailable) {
        return res.status(400).json({ error: `Product ${item.product_id} not available in requested quantity` });
      }
    }

    const subtotalResult = await calculateItemSubtotal(items);
    if (!subtotalResult.valid) {
      return res.status(404).json({ error: subtotalResult.error || 'Unable to calculate order subtotal' });
    }

    const { subtotal, taxAmount, totalAmount } = calculateOrderAmounts(subtotalResult.subtotal);
    const orderId = uuidv4();

    for (const item of items) {
      const productResult = await query('SELECT price FROM products WHERE id = $1', [item.product_id]);

      if (productResult.rows.length === 0) {
        return res.status(404).json({ error: `Product ${item.product_id} not found` });
      }

      const price = productResult.rows[0].price;
      const orderItemId = uuidv4();
      await query(
        'INSERT INTO order_items (id, order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4, $5)',
        [orderItemId, orderId, item.product_id, item.quantity, price]
      );

      await query(
        'UPDATE products SET stock = stock - $1, sold_count = sold_count + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    // Determine order status based on payment method
    const status = payment_method === 'cod' ? 'pending' : 'confirmed';

    // Create order with status and payment method
    await query(
      'INSERT INTO orders (id, user_id, total_amount, status, payment_method, shipping_address) VALUES ($1, $2, $3, $4, $5, $6)',
      [orderId, userId, totalAmount, status, payment_method || 'cod', JSON.stringify(shipping_address)]
    );

    res.status(201).json({
      message: 'Order created successfully',
      order_id: orderId,
      total_amount: totalAmount,
      status: status,
      payment_method: payment_method || 'cod',
      shipping_address: shipping_address,
    });
  } catch (error) {
    console.error('Create order error:', error);
    if (error instanceof Error) {
      if (error.message.includes('shipping_address')) {
        return res.status(400).json({ error: 'Shipping address is required' });
      }
    }
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Cancel order
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.auth?.userId;

    // Check if order belongs to user and get current status
    const orderResult = await query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    // Only allow cancellation if not already shipped/delivered
    if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
    }

    // Get order items to reduce sold_count
    const itemsResult = await query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [id]
    );

    // Reduce sold_count for each product
    for (const item of itemsResult.rows) {
      await query(
        'UPDATE products SET sold_count = GREATEST(0, sold_count - $1) WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    // Update order status to cancelled
    await query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['cancelled', id]
    );

    res.json({ message: 'Order cancelled successfully', status: 'cancelled' });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// Update order status (merchant/admin)
router.patch('/:id/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.auth?.userId;

    // Verify order exists and user has permission (merchant or customer)
    const orderResult = await query(
      `SELECT o.*, p.merchant_id 
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.id = $1 AND (o.user_id = $2 OR p.merchant_id = $2)
       LIMIT 1`,
      [id, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found or unauthorized' });
    }

    const validStatuses = ['pending', 'placed', 'processing', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, id]
    );

    res.json({ message: 'Order status updated', status });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

export default router;
