import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getClient, query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { createTables } from '../db/migrate';
import {
  ORDER_STATUS_FLOW,
  RefundStatus,
  addBusinessDays,
  buildOrderItemSnapshot,
  buildProductSnapshot,
  buildShippingAddressSnapshot,
  normalizeShippingAddress,
  canCustomerCancel,
  calculateItemSubtotal,
  calculateOrderAmounts,
  checkProductStock,
  estimateDeliveryDate,
  loadProductSnapshots,
  normalizeOrderStatus,
  validateShippingAddress,
} from '../utils/orderHelpers';
import { isMissingRelationError, sendServerError } from '../utils/apiError';
import logger from '../logger';

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
  paymentMethod?: string;
  payment_status?: string;
  paymentStatus?: string;
  paymentId?: string | null;
  razorpayOrderId?: string | null;
  razorpaySignature?: string | null;
  idempotency_key?: string;
}

async function appendOrderHistory(
  client: Awaited<ReturnType<typeof getClient>>,
  payload: {
    orderId: string;
    previousStatus: string | null;
    newStatus: string;
    note?: string | null;
    changedBy?: string | null;
    changedByRole?: string | null;
  }
) {
  await client.query(
    `INSERT INTO order_status_history (id, order_id, previous_status, new_status, note, changed_by, changed_by_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [uuidv4(), payload.orderId, payload.previousStatus, payload.newStatus, payload.note || null, payload.changedBy || null, payload.changedByRole || null]
  );
}

async function appendAuditLog(
  client: Awaited<ReturnType<typeof getClient>>,
  payload: {
    orderId: string;
    actorId?: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `INSERT INTO audit_logs (id, order_id, actor_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), payload.orderId, payload.actorId || null, payload.action, JSON.stringify(payload.metadata || {})]
  );
}

async function notifyUsers(
  client: Awaited<ReturnType<typeof getClient>>,
  recipients: string[],
  payload: {
    type: string;
    title: string;
    message: string;
    actorId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  }
) {
  const uniqueRecipients = Array.from(new Set(recipients.filter(Boolean)));
  for (const userId of uniqueRecipients) {
    await client.query(
      `INSERT INTO notifications (id, user_id, actor_id, type, title, message, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uuidv4(), userId, payload.actorId || null, payload.type, payload.title, payload.message, payload.entityType || null, payload.entityId || null]
    );
  }
}

async function safeNotifyUsers(
  client: Awaited<ReturnType<typeof getClient>>,
  recipients: string[],
  payload: {
    type: string;
    title: string;
    message: string;
    actorId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  }
) {
  try {
    await notifyUsers(client, recipients, payload);
  } catch (error) {
    if (isMissingRelationError(error, 'notifications')) {
      try {
        await createTables();
        await notifyUsers(client, recipients, payload);
        return;
      } catch (retryError) {
        logger.error('Notification retry failed:', retryError);
      }
      return;
    }

    logger.error('Notification dispatch failed:', error);
  }
}

async function getOrderSummaryById(orderId: string, userId: string) {
  const result = await query(
    `SELECT o.*,
      (
        SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'quantity', oi.quantity,
          'price', oi.price,
          'product_name', COALESCE((oi.product_snapshot->>'product_name'), p.name),
          'product_image', COALESCE((oi.product_snapshot->>'product_image'), p.image_url),
          'size', oi.product_snapshot->>'size',
          'color', oi.product_snapshot->>'color',
          'snapshot', oi.product_snapshot
        )) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb)
        FROM order_items oi JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = o.id
      ) as items,
      (
        SELECT COALESCE(MAX(COALESCE(m.shop_name, m.name)), 'SHDWMEN')
        FROM order_items oi2
        JOIN products p2 ON oi2.product_id = p2.id
        LEFT JOIN users m ON p2.merchant_id = m.id
        WHERE oi2.order_id = o.id
      ) as seller_name,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', osh.id,
          'previous_status', osh.previous_status,
          'new_status', osh.new_status,
          'note', osh.note,
          'changed_by', osh.changed_by,
          'changed_by_role', osh.changed_by_role,
          'created_at', osh.created_at
        )) FILTER (WHERE osh.id IS NOT NULL), '[]'::jsonb)
        FROM order_status_history osh WHERE osh.order_id = o.id
      ) as status_history
     FROM orders o
     WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId]
  );

  return result.rows[0] || null;
}

// Get user orders
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;

    const status = req.query.status ? normalizeOrderStatus(String(req.query.status)) : null;
    const paymentMethod = req.query.payment_method ? String(req.query.payment_method).toLowerCase() : null;
    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
    const fromDate = req.query.from ? new Date(String(req.query.from)) : null;
    const toDate = req.query.to ? new Date(String(req.query.to)) : null;

    const result = await query(
      `SELECT o.id FROM orders o
       WHERE o.user_id = $1
       ${status ? 'AND o.status = $2' : ''}
       ${paymentMethod ? `AND o.payment_method = $${status ? 3 : 2}` : ''}
       ${fromDate ? `AND o.created_at >= $${(status ? 1 : 0) + (paymentMethod ? 1 : 0) + 2}` : ''}
       ${toDate ? `AND o.created_at <= $${(status ? 1 : 0) + (paymentMethod ? 1 : 0) + (fromDate ? 1 : 0) + 2}` : ''}
       ORDER BY o.created_at DESC`,
      [
        userId,
        ...(status ? [status] : []),
        ...(paymentMethod ? [paymentMethod] : []),
        ...(fromDate ? [fromDate.toISOString()] : []),
        ...(toDate ? [toDate.toISOString()] : []),
      ]
    );

    const orders = [] as any[];
    for (const row of result.rows) {
      const order = await getOrderSummaryById(row.id, userId || '');
      if (!order) continue;

      if (search) {
        const haystack = JSON.stringify(order).toLowerCase();
        if (!haystack.includes(search)) continue;
      }

      orders.push(order);
    }

    res.json(orders);
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch orders');
  }
});

// Get order details
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.auth?.userId;

    const order = await getOrderSummaryById(id, userId || '');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    sendServerError(res, error, 'Failed to fetch order');
  }
});

// Create order
router.post('/', requireAuth, async (req: Request<{}, {}, CreateOrderRequest>, res: Response) => {
  try {
    const {
      items,
      shipping_address,
      payment_method,
      paymentMethod,
      payment_status,
      paymentStatus,
      paymentId,
      razorpayOrderId,
      razorpaySignature,
    } = req.body;
    const userId = req.auth?.userId;
    const idempotencyKey = String(req.headers['idempotency-key'] || req.body.idempotency_key || '').trim();
    const normalizedPaymentMethod = String(paymentMethod || payment_method || 'COD').trim().toUpperCase();
    const normalizedPaymentStatus = String(paymentStatus || payment_status || (normalizedPaymentMethod === 'COD' ? 'PENDING' : 'PAID')).trim().toUpperCase();
    const normalizedPaymentId = paymentId || null;
    const normalizedRazorpayOrderId = razorpayOrderId || null;
    const normalizedRazorpaySignature = razorpaySignature || null;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order items required' });
    }

    if (normalizedPaymentMethod === 'ONLINE') {
      return res.status(400).json({ error: 'Use Razorpay verification flow for online payments' });
    }

    if (!['COD', 'ONLINE'].includes(normalizedPaymentMethod)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    if (normalizedPaymentMethod === 'COD') {
      if (normalizedPaymentId || normalizedRazorpayOrderId || normalizedRazorpaySignature) {
        // Ignore Razorpay fields for COD, but do not fail the order.
      }
    }

    const client = await getClient();
    const userRowRes = await client.query('SELECT name, email FROM users WHERE id = $1', [userId]);
    const dbUser = userRowRes.rows[0] || {};
    const validatedShippingAddress = normalizeShippingAddress(shipping_address, dbUser.email);
    if (!validatedShippingAddress) {
      client.release();
      return res.status(400).json({ error: 'Invalid shipping address payload' });
    }
    const addressValidation = validateShippingAddress(validatedShippingAddress, dbUser.email);
    if (!addressValidation.valid) {
      return res.status(400).json({ error: 'Invalid shipping address', details: addressValidation.errors });
    }
    try {
      await client.query('BEGIN');
      const postCommitNotifications: Array<{
        recipients: string[];
        payload: {
          type: string;
          title: string;
          message: string;
          actorId?: string | null;
          entityType?: string | null;
          entityId?: string | null;
        };
      }> = [];

      if (idempotencyKey) {
        const idempotencyResult = await client.query(
          'SELECT order_id FROM idempotency_keys WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE',
          [userId, idempotencyKey]
        );

        if (idempotencyResult.rows.length > 0 && idempotencyResult.rows[0].order_id) {
          const existingOrder = await getOrderSummaryById(idempotencyResult.rows[0].order_id, userId);
          await client.query('ROLLBACK');
          return res.status(200).json({ message: 'Order already processed', order: existingOrder });
        }

        await client.query(
          `INSERT INTO idempotency_keys (id, user_id, idempotency_key, request_hash)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [uuidv4(), userId, idempotencyKey, JSON.stringify(items)]
        );
      }

      const productIds = items.map((item) => item.product_id);
      const products = await client.query(
        `SELECT id, merchant_id, name, price, image_url, imgs, stock, estimated_delivery_days
         FROM products
         WHERE id = ANY($1::uuid[])
         FOR UPDATE`,
        [productIds]
      );

      if (products.rows.length !== productIds.length) {
        throw new Error('One or more products were not found');
      }

      const productMap = new Map(products.rows.map((product) => [product.id, product]));
      let subtotal = 0;
      let maxDeliveryDays = 0;

      for (const item of items) {
        const product = productMap.get(item.product_id);
        if (!product) {
          throw new Error(`Product ${item.product_id} not found`);
        }

        const stock = Number(product.stock || 0);
        if (stock < item.quantity) {
          throw new Error(`Product ${product.name} is out of stock in the requested quantity`);
        }

        subtotal += Number(product.price || 0) * item.quantity;
        maxDeliveryDays = Math.max(maxDeliveryDays, Number(product.estimated_delivery_days || 0));
      }

      const { totalAmount } = calculateOrderAmounts(subtotal);
      const orderId = uuidv4();
      const addressSnapshot = buildShippingAddressSnapshot(validatedShippingAddress);
      const orderSnapshot = items.map((item) => buildProductSnapshot(productMap.get(item.product_id), item.quantity));
      const estimatedDeliveryDate = estimateDeliveryDate(new Date(), maxDeliveryDays || 5);
      const merchantIds = Array.from(new Set(products.rows.map((product) => product.merchant_id).filter(Boolean)));
      const dbPaymentMethod = normalizedPaymentMethod === 'COD' ? 'cod' : 'razorpay';
      const dbPaymentStatus = normalizedPaymentMethod === 'COD' ? 'pending' : 'captured';

      // Resolve customer name/email with priority: shipping address -> Clerk/users table -> null
      const dbUser = (await client.query('SELECT name, email FROM users WHERE id = $1', [userId])).rows[0] || {};
      const customerName = (addressSnapshot && addressSnapshot.name) || dbUser.name || null;
      const customerEmail = (addressSnapshot && addressSnapshot.email) || dbUser.email || null;

      await client.query(
        `INSERT INTO orders (
          id, user_id, customer_name, customer_email, total_amount, status, payment_method, payment_status, payment_id, razorpay_order_id, razorpay_signature,
          shipping_address, address_snapshot, order_snapshot, estimated_delivery_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          orderId,
          userId,
          customerName,
          customerEmail,
          totalAmount,
          'pending',
          dbPaymentMethod,
          dbPaymentStatus,
          dbPaymentMethod === 'razorpay' ? normalizedPaymentId : null,
          dbPaymentMethod === 'razorpay' ? normalizedRazorpayOrderId : null,
          dbPaymentMethod === 'razorpay' ? normalizedRazorpaySignature : null,
          JSON.stringify(shipping_address),
          JSON.stringify(addressSnapshot),
          JSON.stringify(orderSnapshot),
          estimatedDeliveryDate,
        ]
      );

      for (const item of items) {
        const product = productMap.get(item.product_id);
        const orderItemId = uuidv4();
        const productSnapshot = buildOrderItemSnapshot(product, item.quantity);

        const stockUpdate = await client.query(
          'UPDATE products SET stock = stock - $1, sold_count = sold_count + $1 WHERE id = $2 AND stock >= $1',
          [item.quantity, item.product_id]
        );

        if (stockUpdate.rowCount === 0) {
          throw new Error(`Stock changed while placing order for ${product.name}`);
        }

        await client.query(
          'INSERT INTO order_items (id, order_id, product_id, quantity, price, product_snapshot) VALUES ($1, $2, $3, $4, $5, $6)',
          [orderItemId, orderId, item.product_id, item.quantity, product.price, JSON.stringify(productSnapshot)]
        );

        const updatedProduct = await client.query('SELECT stock FROM products WHERE id = $1', [item.product_id]);
        const remainingStock = Number(updatedProduct.rows[0]?.stock || 0);
        if (remainingStock > 0 && remainingStock <= 5 && merchantIds.length > 0) {
          postCommitNotifications.push({
            recipients: merchantIds,
            payload: {
              type: 'low_stock',
              title: 'Low stock alert',
              message: `${product.name} is running low with ${remainingStock} items left.`,
              entityType: 'product',
              entityId: item.product_id,
            },
          });
        }
      }

      await appendOrderHistory(client, {
        orderId,
        previousStatus: null,
        newStatus: 'pending',
        note: 'Order created',
        changedBy: userId,
        changedByRole: 'customer',
      });

      await appendAuditLog(client, {
        orderId,
        actorId: userId,
        action: 'order_created',
        metadata: { payment_method: dbPaymentMethod, payment_status: dbPaymentStatus, totalAmount, itemCount: items.length },
      });

      postCommitNotifications.push({
        recipients: [String(userId)],
        payload: {
          type: 'order_placed',
          title: 'Order placed',
          message: 'Your order has been placed successfully and is awaiting confirmation.',
          actorId: userId,
          entityType: 'order',
          entityId: orderId,
        },
      });
      postCommitNotifications.push({
        recipients: merchantIds,
        payload: {
          type: 'new_order',
          title: 'New order received',
          message: `Order ${orderId.slice(0, 8)} has been placed.`,
          actorId: userId,
          entityType: 'order',
          entityId: orderId,
        },
      });

      if (idempotencyKey) {
        await client.query(
          'UPDATE idempotency_keys SET order_id = $1 WHERE user_id = $2 AND idempotency_key = $3',
          [orderId, userId, idempotencyKey]
        );
      }

      await client.query('COMMIT');

      for (const notification of postCommitNotifications) {
        await safeNotifyUsers(client, notification.recipients, notification.payload);
      }

      const createdOrder = await getOrderSummaryById(orderId, userId);
      res.status(201).json({
        message: 'Order created successfully',
        order_id: orderId,
        order: createdOrder,
      });
    } catch (transactionError) {
      await client.query('ROLLBACK');
      throw transactionError;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Create order error:', error);
    if (error instanceof Error) {
      if (error.message.includes('shipping_address')) {
        return res.status(400).json({ error: 'Shipping address is required' });
      }
      if (error.message.toLowerCase().includes('stock')) {
        return res.status(400).json({ error: error.message });
      }
    }
    return sendServerError(res, error, 'Failed to create order');
  }
});

// Cancel order
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { cancelReason, cancelReasonType } = req.body as { cancelReason?: string; cancelReasonType?: string };
    const userId = req.auth?.userId;
    logger.info('[ORDERS][CANCEL] — Order ID:', id);
    logger.info('[ORDERS][CANCEL] — User ID:', userId);
    logger.info('[ORDERS][CANCEL] — Body:', req.body);
    logger.info('[ORDERS][CANCEL] payload:', { cancelReason, cancelReasonType });
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const postCommitNotifications: Array<{
        recipients: string[];
        payload: {
          type: string;
          title: string;
          message: string;
          actorId?: string | null;
          entityType?: string | null;
          entityId?: string | null;
        };
      }> = [];

      // Lock order for update
      const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (orderResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }

      const order = orderResult.rows[0];
      logger.info('[ORDERS][CANCEL] — Order:', order);
      const normalizedStatus = normalizeOrderStatus(order.status);

      // Check if requester is customer or merchant for this order
      const isCustomer = String(order.user_id) === String(userId);
      let isMerchant = false;
      const merchantCheck = await client.query(
        `SELECT DISTINCT p.merchant_id
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = $1`,
        [id]
      );
      const merchantOwnerIds = Array.from(new Set(merchantCheck.rows.map((r: any) => r.merchant_id).filter(Boolean)));
      if (merchantOwnerIds.includes(userId)) {
        isMerchant = true;
      }

      if (!isCustomer && !isMerchant) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found or unauthorized' });
      }

      if (isCustomer && !canCustomerCancel(normalizedStatus)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
      }

      const itemsResult = await client.query(
        `SELECT oi.*, p.merchant_id
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = $1`,
        [id]
      );
      for (const item of itemsResult.rows) {
        const updateRes = await client.query(
          'UPDATE products SET stock = stock + $1, sold_count = GREATEST(0, sold_count - $1) WHERE id = $2',
          [item.quantity, item.product_id]
        );
        if (updateRes.rowCount === 0) {
          throw new Error(`Product not found for order item ${item.id}`);
        }
      }

      const refundStatus: RefundStatus | null = order.payment_method === 'cod' ? null : 'initiated';
      const refundId = order.payment_method === 'cod' ? null : `rfnd_${uuidv4().replace(/-/g, '')}`;
      const expectedRefundDate = order.payment_method === 'cod' ? null : addBusinessDays(new Date(), 10).toISOString();
      const isRefundable = order.payment_method !== 'cod';

      if (isRefundable) {
        await client.query(
          `UPDATE orders
           SET status = 'cancelled',
               cancelled_at = CURRENT_TIMESTAMP,
               cancel_reason = $2,
               cancel_reason_type = $3,
               cancelled_by = $4,
               refund_id = COALESCE($5, refund_id),
               refund_amount = total_amount,
               refund_status = 'initiated',
               refund_initiated_at = CURRENT_TIMESTAMP,
               expected_refund_date = $6::timestamp,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id, cancelReason || null, cancelReasonType || null, isMerchant ? 'merchant' : 'customer', refundId, expectedRefundDate]
        );

        await client.query(
          `INSERT INTO refunds (id, order_id, refund_id, refund_amount, refund_status, expected_refund_date, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (order_id) DO UPDATE SET
             refund_id = EXCLUDED.refund_id,
             refund_amount = EXCLUDED.refund_amount,
             refund_status = EXCLUDED.refund_status,
             expected_refund_date = EXCLUDED.expected_refund_date`,
          [uuidv4(), id, refundId, order.total_amount, 'initiated', expectedRefundDate, JSON.stringify({ source: 'customer_cancel' })]
        );
      } else {
        await client.query(
          `UPDATE orders
           SET status = 'cancelled',
               cancelled_at = CURRENT_TIMESTAMP,
               cancel_reason = $2,
               cancel_reason_type = $3,
               cancelled_by = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id, cancelReason || null, cancelReasonType || null, isMerchant ? 'merchant' : 'customer']
        );
      }

      await appendOrderHistory(client, {
        orderId: id,
        previousStatus: order.status,
        newStatus: 'cancelled',
        note: `Cancelled by ${isMerchant ? 'merchant' : 'customer'}${cancelReason ? `: ${cancelReason}` : ''}`,
        changedBy: userId,
        changedByRole: isMerchant ? 'merchant' : 'customer',
      });
      await appendAuditLog(client, {
        orderId: id,
        actorId: userId,
        action: 'order_cancelled',
        metadata: { refundStatus, refundId, cancelReason: cancelReason || null, cancelReasonType: cancelReasonType || null },
      });

      const itemMerchantIds = Array.from(new Set(itemsResult.rows.map((item: any) => item.merchant_id).filter(Boolean)));
      postCommitNotifications.push({
        recipients: [String(userId)],
        payload: {
          type: 'order_cancelled',
          title: 'Order cancelled',
          message: 'Your order has been cancelled successfully.',
          actorId: userId,
          entityType: 'order',
          entityId: id,
        },
      });
      if (itemMerchantIds.length > 0) {
        postCommitNotifications.push({
          recipients: itemMerchantIds,
          payload: {
            type: 'order_cancelled',
            title: 'Order cancelled',
            message: `Order ${id.slice(0, 8)} was cancelled by the ${isMerchant ? 'merchant' : 'customer'}.`,
            actorId: userId,
            entityType: 'order',
            entityId: id,
          },
        });
      }

      await client.query('COMMIT');

      for (const notification of postCommitNotifications) {
        await safeNotifyUsers(client, notification.recipients, notification.payload);
      }

      res.json({ message: 'Order cancelled successfully', status: 'cancelled' });
    } catch (transactionError) {
      await client.query('ROLLBACK');
      throw transactionError;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Cancel Order Error:', error);
    if (error instanceof Error) {
      return res.status(500).json({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
    return res.status(500).json({ error: 'Unknown error' });
  }
});

// Update order status (merchant/admin)
router.patch('/:id/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, cancelReason, cancelReasonType } = req.body;
    const userId = req.auth?.userId;
    logger.info('[ORDERS][STATUS] — Order ID:', id);
    logger.info('[ORDERS][STATUS] — User ID:', userId);
    logger.info('[ORDERS][STATUS] — Body:', req.body);
    logger.info('[ORDERS][STATUS] payload:', { status, cancelReason, cancelReasonType });

    if (!ORDER_STATUS_FLOW.includes(normalizeOrderStatus(status))) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const normalizedStatus = normalizeOrderStatus(status);
    const client = await getClient();

    try {
      await client.query('BEGIN');
      const postCommitNotifications: Array<{
        recipients: string[];
        payload: {
          type: string;
          title: string;
          message: string;
          actorId?: string | null;
          entityType?: string | null;
          entityId?: string | null;
        };
      }> = [];

      const merchantCheck = await client.query(
        `SELECT DISTINCT p.merchant_id
         FROM orders o
         JOIN order_items oi ON o.id = oi.order_id
         JOIN products p ON oi.product_id = p.id
         WHERE o.id = $1`,
        [id]
      );

      const merchantIds = Array.from(new Set(merchantCheck.rows.map((row: any) => row.merchant_id).filter(Boolean)));
      const isMerchant = merchantIds.includes(userId);
      if (!isMerchant) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found or unauthorized' });
      }

      const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
      const order = orderResult.rows[0];
      logger.info('[ORDERS][STATUS] — Order:', order);
      if (!order) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found or unauthorized' });
      }

      const previousStatus = normalizeOrderStatus(order.status);
      if (previousStatus === normalizedStatus) {
        await client.query('ROLLBACK');
        return res.json({ message: 'Order status updated', status: normalizedStatus });
      }

      // Build SET clause and params sequentially to avoid ambiguous $n types
      const params: any[] = [];
      // $1 = new status
      params.push(normalizedStatus);

      const setParts: string[] = [];
      setParts.push(`status = $1`);
      setParts.push(`delivered_at = CASE WHEN $1::varchar = 'delivered'::varchar THEN CURRENT_TIMESTAMP ELSE delivered_at END`);
      setParts.push(`cancelled_at = CASE WHEN $1::varchar = 'cancelled'::varchar THEN CURRENT_TIMESTAMP ELSE cancelled_at END`);
      setParts.push(`refund_status = CASE WHEN $1::varchar = 'refunded'::varchar THEN 'completed'::varchar ELSE refund_status END`);
      setParts.push(`refund_completed_at = CASE WHEN $1::varchar = 'refunded'::varchar THEN CURRENT_TIMESTAMP ELSE refund_completed_at END`);

      if (normalizedStatus === 'cancelled') {
        // add cancel fields with sequential params
        params.push(cancelReason || null); // $2
        params.push(cancelReasonType || null); // $3
        params.push(isMerchant ? 'merchant' : 'customer'); // $4
        setParts.push(`cancel_reason = $2`);
        setParts.push(`cancel_reason_type = $3`);
        setParts.push(`cancelled_by = $4`);
      }

      setParts.push('updated_at = CURRENT_TIMESTAMP');

      // WHERE id param
      params.push(id); // next param ($n)
      const idParamIndex = params.length;

      const updateSetClause = setParts.join(',\n             ');

      await client.query(
        `UPDATE orders
         SET ${updateSetClause}
         WHERE id = $${idParamIndex}`,
        params
      );

      if (normalizedStatus === 'cancelled' || normalizedStatus === 'returned') {
        const itemsResult = await client.query(
          `SELECT oi.*, p.merchant_id
           FROM order_items oi
           JOIN products p ON oi.product_id = p.id
           WHERE oi.order_id = $1`,
          [id]
        );
        for (const item of itemsResult.rows) {
          const updateRes = await client.query(
            'UPDATE products SET stock = stock + $1, sold_count = GREATEST(0, sold_count - $1) WHERE id = $2',
            [item.quantity, item.product_id]
          );
          if (updateRes.rowCount === 0) {
            throw new Error(`Product not found for order item ${item.id}`);
          }
        }

        if (order.payment_method !== 'cod') {
          const refundId = order.refund_id || `rfnd_${uuidv4().replace(/-/g, '')}`;
          const expectedRefundDate = addBusinessDays(new Date(), 10).toISOString();
          await client.query(
            `INSERT INTO refunds (id, order_id, refund_id, refund_amount, refund_status, refund_initiated_at, expected_refund_date, metadata)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7)
             ON CONFLICT (order_id) DO UPDATE SET
               refund_id = EXCLUDED.refund_id,
               refund_amount = EXCLUDED.refund_amount,
               refund_status = EXCLUDED.refund_status,
               expected_refund_date = EXCLUDED.expected_refund_date`,
            [uuidv4(), id, refundId, order.total_amount, 'initiated', expectedRefundDate, JSON.stringify({ source: 'merchant_transition', status: normalizedStatus })]
          );
          await client.query(
            `UPDATE orders SET refund_id = $1, refund_amount = $2, refund_status = 'initiated', refund_initiated_at = CURRENT_TIMESTAMP, expected_refund_date = $3 WHERE id = $4`,
            [refundId, order.total_amount, expectedRefundDate, id]
          );
          postCommitNotifications.push({
            recipients: [order.user_id],
            payload: {
              type: 'refund_initiated',
              title: 'Refund initiated',
              message: 'Refund will be credited within 7–14 business days.',
              actorId: userId,
              entityType: 'order',
              entityId: id,
            },
          });
        }
      }

      await appendOrderHistory(client, {
        orderId: id,
        previousStatus,
        newStatus: normalizedStatus,
        note: `Status changed to ${normalizedStatus}`,
        changedBy: userId,
        changedByRole: 'merchant',
      });
      await appendAuditLog(client, {
        orderId: id,
        actorId: userId,
        action: `order_${normalizedStatus}`,
        metadata: { previousStatus, newStatus: normalizedStatus },
      });

      postCommitNotifications.push({
        recipients: [order.user_id],
        payload: {
          type: `order_${normalizedStatus}`,
          title: `Order ${normalizedStatus}`,
          message: `Your order is now ${normalizedStatus.replace(/_/g, ' ')}.`,
          actorId: userId,
          entityType: 'order',
          entityId: id,
        },
      });

      if (normalizedStatus === 'delivered') {
        postCommitNotifications.push({
          recipients: [String(userId)],
          payload: {
            type: 'merchant_delivered',
            title: 'Order delivered',
            message: `Order ${id.slice(0, 8)} has been delivered.`,
            actorId: userId,
            entityType: 'order',
            entityId: id,
          },
        });
      }

      await client.query('COMMIT');

      for (const notification of postCommitNotifications) {
        await safeNotifyUsers(client, notification.recipients, notification.payload);
      }
      res.json({ message: 'Order status updated', status: normalizedStatus });
    } catch (transactionError) {
      await client.query('ROLLBACK');
      throw transactionError;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Update Order Status Error:', error);
    if (error instanceof Error) {
      return res.status(500).json({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
    return res.status(500).json({ error: 'Unknown error' });
  }
});

export default router;
