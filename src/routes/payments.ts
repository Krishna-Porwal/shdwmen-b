import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from '../config';
import {
  checkProductStock,
  calculateItemSubtotal,
  calculateOrderAmounts,
  validateShippingAddress,
} from '../utils/orderHelpers';

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

// Create Razorpay order
router.post('/razorpay/create-order', requireAuth, async (req: Request<{}, {}, PaymentCreateRequest>, res: Response) => {
  try {
    const { amount, items, shipping_address } = req.body;
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

    res.json({
      razorpay_order_id: orderId,
      razorpay_order_number: orderReceipt,
      amount: orderAmount,
    });
  } catch (error) {
    console.error('Create Razorpay order error:', error);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// Verify Razorpay payment and create order
router.post('/razorpay/verify', requireAuth, async (req: Request<{}, {}, PaymentVerifyRequest>, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, items, shipping_address } = req.body;
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

    const orderId = uuidv4();

    for (const item of items) {
      const productAvailable = await checkProductStock(item.product_id, item.quantity);
      if (!productAvailable) {
        return res.status(400).json({ error: `Product ${item.product_id} not available in requested quantity` });
      }

      const productResult = await query('SELECT price FROM products WHERE id = $1', [item.product_id]);
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

    await query(
      'INSERT INTO orders (id, user_id, total_amount, status, payment_method, payment_id, shipping_address) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [orderId, userId, totalAmount, 'confirmed', 'razorpay', razorpay_payment_id, JSON.stringify(shipping_address)]
    );

    res.status(201).json({
      message: 'Payment verified and order created successfully',
      order_id: orderId,
      total_amount: totalAmount,
      status: 'confirmed',
      payment_id: razorpay_payment_id,
    });
  } catch (error) {
    console.error('Verify Razorpay payment error:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

export default router;
