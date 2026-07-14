import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import app from '../../src/index';
import { createTestUser, createTestMerchant, createTestProduct, clearTestData } from '../helpers/factories';
import { createTables } from '../../src/db/migrate';
import { query } from '../../src/db/connection';
import { JWT_SECRET, RAZORPAY_KEY_SECRET } from '../../src/config';

const api = request(app);

function genTokenFor(userId: string, role = 'customer') {
  const payload: any = { userId, role };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function signRazorpay(razorpay_order_id: string, razorpay_payment_id: string) {
  const shasum = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
  shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  return shasum.digest('hex');
}

describe('Payment idempotency', () => {
  let userId: string;
  let merchantId: string;
  let productId: string;

  beforeAll(async () => {
    await createTables();
    await clearTestData();
    merchantId = await createTestMerchant('test-merchant-pay');
    userId = await createTestUser('test-user-pay');
    productId = await createTestProduct(merchantId, { price: 100, stock: 10 });
  });

  afterAll(async () => {
    await clearTestData();
  });

  test('concurrent verify requests create only one order', async () => {
    const token = genTokenFor(userId, 'customer');
    const razorpay_order_id = `order_test_${Date.now()}`;
    const razorpay_payment_id = `pay_test_${Date.now()}`;
    const signature = signRazorpay(razorpay_order_id, razorpay_payment_id);

    const body = {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature: signature,
      items: [{ product_id: productId, quantity: 1 }],
      shipping_address: { name: 'T', email: 't@example.com', phone: '999', address: 'x', city: 'y', state: 'z', pincode: '000' }
    };

    const req1 = api.post('/api/payments/razorpay/verify').set('Authorization', `Bearer ${token}`).send(body);
    const req2 = api.post('/api/payments/razorpay/verify').set('Authorization', `Bearer ${token}`).send(body);

    const results = await Promise.all([req1, req2]);
    const statuses = results.map(r => r.status);
    expect(statuses.some(s => s === 201)).toBeTruthy();
    // One should be 201 (created) and the other should return 200 with existing order
    const orders = await query('SELECT * FROM orders WHERE payment_id = $1', [razorpay_payment_id]);
    expect(orders.rows.length).toBe(1);
  }, 20000);

});
