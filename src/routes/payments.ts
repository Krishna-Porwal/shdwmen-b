import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { getClient, query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { createTables } from '../db/migrate';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from '../config';
import {
  addBusinessDays,
  buildOrderItemSnapshot,
  buildProductSnapshot,
  buildShippingAddressSnapshot,
  checkProductStock,
  calculateItemSubtotal,
  calculateOrderAmounts,
  validateShippingAddress,
  estimateDeliveryDate,
} from '../utils/orderHelpers';
import { isMissingRelationError, sendServerError } from '../utils/apiError';
import logger from '../logger';

const router: Router = express.Router();

interface PaymentCreateRequest {
  amount: number;
  items: Array<{ product_id: string; quantity: number }>;
  shipping_address: any;
}

interface PaymentVerifyRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  items: Array<{ product_id: string; quantity: number }>;
  shipping_address: any;
}

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

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

// Create Razorpay order
router.post('/razorpay/create-order', requireAuth, async (req: Request<{}, {}, PaymentCreateRequest>, res: Response) => {
  try {
    const { amount, items, shipping_address } = req.body;
    const idempotencyKey = String(req.headers['idempotency-key'] || req.body.idempotency_key || '').trim();
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found' });
    }

    const addressValidation = validateShippingAddress(shipping_address);
    if (!addressValidation.valid) {
      return res.status(400).json({ error: 'Invalid shipping address', details: addressValidation.errors });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order items required' });
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
    const expectedAmount = Math.round(totalAmount * 100);

    if (typeof amount !== 'number' || amount !== expectedAmount) {
      return res.status(400).json({ error: 'Order amount mismatch or invalid amount submitted' });
    }

    if (expectedAmount < 100) {
      return res.status(400).json({ error: 'Order amount must be at least ₹1' });
    }

    const existingIdempotency = idempotencyKey
      ? await query('SELECT metadata FROM idempotency_keys WHERE idempotency_key = $1', [idempotencyKey])
      : null;

    if (existingIdempotency?.rows?.length > 0) {
      const existingMeta = existingIdempotency.rows[0]?.metadata || {};
      if (existingMeta.razorpay_order_id) {
        return res.json({
          razorpay_order_id: existingMeta.razorpay_order_id,
          razorpay_order_number: existingMeta.razorpay_order_number,
          amount: existingMeta.amount,
          idempotency_key: idempotencyKey,
        });
      }
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: expectedAmount,
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      notes: {
        userId,
        itemCount: items.length.toString(),
        subtotal: subtotal.toString(),
        taxAmount: taxAmount.toString(),
      },
    });

    const orderId = (razorpayOrder as any).id;
    const orderReceipt = (razorpayOrder as any).receipt;
    const orderAmount = (razorpayOrder as any).amount;

    if (idempotencyKey) {
      await query(
        `INSERT INTO idempotency_keys (id, user_id, idempotency_key, request_hash, metadata)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (idempotency_key) DO UPDATE SET metadata = EXCLUDED.metadata`,
        [uuidv4(), userId, idempotencyKey, JSON.stringify({ amount, items, shipping_address }), JSON.stringify({ razorpay_order_id: orderId, razorpay_order_number: orderReceipt, amount: orderAmount })]
      );
    }

    res.json({
      razorpay_order_id: orderId,
      razorpay_order_number: orderReceipt,
      amount: orderAmount,
      idempotency_key: idempotencyKey || undefined,
    });
  } catch (error) {
    sendServerError(res, error, 'Failed to create payment order');
  }
});

// Verify Razorpay payment and create order
router.post('/razorpay/verify', requireAuth, async (req: Request<{}, {}, PaymentVerifyRequest>, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, items, shipping_address } = req.body;
    const idempotencyKey = String(req.headers['idempotency-key'] || req.body.idempotency_key || '').trim();
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found' });
    }

    const shasum = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const digest = shasum.digest('hex');

    if (digest !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const addressValidation = validateShippingAddress(shipping_address);
    if (!addressValidation.valid) {
      return res.status(400).json({ error: 'Invalid shipping address', details: addressValidation.errors });
    }

    const subtotalResult = await calculateItemSubtotal(items);
    if (!subtotalResult.valid) {
      return res.status(404).json({ error: subtotalResult.error || 'Unable to calculate order subtotal' });
    }

    const { subtotal, taxAmount, totalAmount } = calculateOrderAmounts(subtotalResult.subtotal);
    const expectedAmount = Math.round(totalAmount * 100);

    const razorpayOrder = await razorpay.orders.fetch(razorpay_order_id);
    if (!razorpayOrder || (razorpayOrder as any).amount !== expectedAmount) {
      return res.status(400).json({ error: 'Payment amount mismatch' });
    }

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

      if (idempotencyKey) {
        const idempotencyResult = await client.query(
          'SELECT order_id FROM idempotency_keys WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE',
          [userId, idempotencyKey]
        );

        if (idempotencyResult.rows.length > 0 && idempotencyResult.rows[0].order_id) {
          const existingOrder = await query('SELECT * FROM orders WHERE id = $1', [idempotencyResult.rows[0].order_id]);
          await client.query('ROLLBACK');
          return res.status(200).json({
            message: 'Order already processed',
            order_id: existingOrder.rows[0]?.id,
            status: existingOrder.rows[0]?.status,
            payment_id: razorpay_payment_id,
          });
        }

        if (idempotencyResult.rows.length === 0) {
          await client.query(
            `INSERT INTO idempotency_keys (id, user_id, idempotency_key, request_hash)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [uuidv4(), userId, idempotencyKey, JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature, items, shipping_address })]
          );
        }
      }

      const existingPayment = await client.query(
        'SELECT id FROM orders WHERE payment_id = $1 FOR UPDATE',
        [razorpay_payment_id]
      );

      if (existingPayment.rows.length > 0) {
        await client.query('ROLLBACK');
        const existingOrder = await query('SELECT * FROM orders WHERE payment_id = $1', [razorpay_payment_id]);
        return res.status(200).json({
          message: 'Payment already processed',
          order_id: existingOrder.rows[0]?.id,
          status: existingOrder.rows[0]?.status,
          payment_id: razorpay_payment_id,
        });
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
      let maxDeliveryDays = 0;
      for (const item of items) {
        const product = productMap.get(item.product_id);
        if (!product) {
          throw new Error(`Product ${item.product_id} not found`);
        }

        const productAvailable = await checkProductStock(item.product_id, item.quantity);
        if (!productAvailable) {
          throw new Error(`Product ${product.name} not available in requested quantity`);
        }

        maxDeliveryDays = Math.max(maxDeliveryDays, Number(product.estimated_delivery_days || 0));
      }

      const orderId = uuidv4();
      const addressSnapshot = buildShippingAddressSnapshot(shipping_address);
      // Resolve customer name/email with priority: shipping address -> users table -> null
      const dbUserRow = (await client.query('SELECT name, email FROM users WHERE id = $1', [userId])).rows[0] || {};
      const customerName = (addressSnapshot && addressSnapshot.name) || dbUserRow.name || null;
      const customerEmail = (addressSnapshot && addressSnapshot.email) || dbUserRow.email || null;
      const orderSnapshot = items.map((item) => buildProductSnapshot(productMap.get(item.product_id), item.quantity));
      const estimatedDeliveryDate = estimateDeliveryDate(new Date(), maxDeliveryDays || 5);
      const merchantIds = Array.from(new Set(products.rows.map((product) => product.merchant_id).filter(Boolean)));

      try {
        await client.query(
          `INSERT INTO orders (
            id, user_id, customer_name, customer_email, total_amount, status, payment_method, payment_id, payment_status,
            shipping_address, address_snapshot, order_snapshot, estimated_delivery_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            orderId,
            userId,
            customerName,
            customerEmail,
            totalAmount,
            'confirmed',
            'razorpay',
            razorpay_payment_id,
            'captured',
            JSON.stringify(shipping_address),
            JSON.stringify(addressSnapshot),
            JSON.stringify(orderSnapshot),
            estimatedDeliveryDate,
          ]
        );
      } catch (insertErr: any) {
        // Handle unique violation on payment_id (another process inserted the order)
        if (insertErr && insertErr.code === '23505') {
          await client.query('ROLLBACK');
          const existingOrder = await query('SELECT * FROM orders WHERE payment_id = $1', [razorpay_payment_id]);
          return res.status(200).json({
            message: 'Payment already processed',
            order_id: existingOrder.rows[0]?.id,
            status: existingOrder.rows[0]?.status,
            payment_id: razorpay_payment_id,
          });
        }
        throw insertErr;
      }

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
      }

      await appendOrderHistory(client, {
        orderId,
        previousStatus: null,
        newStatus: 'confirmed',
        note: 'Payment captured and order created',
        changedBy: userId,
        changedByRole: 'customer',
      });
      await appendAuditLog(client, {
        orderId,
        actorId: userId,
        action: 'payment_verified',
        metadata: { razorpay_payment_id, razorpay_order_id, totalAmount },
      });

      if (idempotencyKey) {
        await client.query(
          'UPDATE idempotency_keys SET order_id = $1 WHERE user_id = $2 AND idempotency_key = $3',
          [orderId, userId, idempotencyKey]
        );
      }

      postCommitNotifications.push({
        recipients: [String(userId)],
        payload: {
          type: 'order_confirmed',
          title: 'Order confirmed',
          message: 'Your payment was captured and the order has been confirmed.',
          actorId: userId,
          entityType: 'order',
          entityId: orderId,
        },
      });
      postCommitNotifications.push({
        recipients: merchantIds,
        payload: {
          type: 'new_order',
          title: 'New paid order received',
          message: `Paid order ${orderId.slice(0, 8)} is ready for fulfillment.`,
          actorId: userId,
          entityType: 'order',
          entityId: orderId,
        },
      });

      await client.query('COMMIT');

      for (const notification of postCommitNotifications) {
        await safeNotifyUsers(client, notification.recipients, notification.payload);
      }

      res.status(201).json({
        message: 'Payment verified and order created successfully',
        order_id: orderId,
        total_amount: totalAmount,
        status: 'confirmed',
        payment_id: razorpay_payment_id,
      });
    } catch (transactionError) {
      await client.query('ROLLBACK');
      throw transactionError;
    } finally {
      client.release();
    }
  } catch (error) {
    sendServerError(res, error, 'Failed to verify payment');
  }
});

export default router;
