import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/index';
import { createTestUser, createTestMerchant, createTestProduct, createTestOrder, clearTestData } from '../helpers/factories';
import { createTables } from '../../src/db/migrate';
import { query } from '../../src/db/connection';
import { JWT_SECRET } from '../../src/config';

const api = request(app);

function genTokenFor(userId: string, role = 'customer') {
  const payload: any = { userId, role };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

describe('Refund lifecycle and notification resilience', () => {
  let userId: string;
  let merchantId: string;
  let productId: string;
  let orderId: string;

  beforeAll(async () => {
    await createTables();
    await clearTestData();
    merchantId = await createTestMerchant('test-merchant-refund');
    userId = await createTestUser('test-user-refund');
    productId = await createTestProduct(merchantId, { price: 200, stock: 5 });
    orderId = await createTestOrder(userId, productId, merchantId, { quantity: 1, price: 200, status: 'pending', payment_method: 'razorpay' });
    await query('UPDATE products SET stock = stock - 1, sold_count = sold_count + 1 WHERE id = $1', [productId]);
  });

  afterAll(async () => {
    await clearTestData();
  });

  test('inventory restored after cancellation and refund row created', async () => {
    const token = genTokenFor(userId);
    const res = await api.post(`/api/orders/${orderId}/cancel`).set('Authorization', `Bearer ${token}`).send({ cancelReason: 'Test refund', cancelReasonType: 'customer' });
    expect(res.status).toBe(200);

    const product = await query('SELECT stock, sold_count FROM products WHERE id = $1', [productId]);
    expect(Number(product.rows[0].stock)).toBe(5);
    expect(Number(product.rows[0].sold_count)).toBe(0);

    const refund = await query('SELECT refund_status, refund_completed_at FROM refunds WHERE order_id = $1', [orderId]);
    expect(refund.rows[0].refund_status).toBe('initiated');
    expect(refund.rows[0].refund_completed_at).toBeNull();
  });
});
