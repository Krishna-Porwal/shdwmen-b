import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/index';
import { createTestUser, createTestMerchant, createTestProduct, clearTestData } from '../helpers/factories';
import { createTables } from '../../src/db/migrate';
import { query } from '../../src/db/connection';
import { JWT_SECRET } from '../../src/config';

const api = request(app);

function genTokenFor(userId: string, role = 'customer') {
  const payload: any = { userId, role };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

describe('Idempotency key reuse', () => {
  let userId: string;
  let merchantId: string;
  let productId: string;

  beforeAll(async () => {
    await createTables();
    await clearTestData();
    merchantId = await createTestMerchant('test-merchant-idemp');
    userId = await createTestUser('test-user-idemp');
    productId = await createTestProduct(merchantId, { price: 100, stock: 5 });
  });

  afterAll(async () => {
    await clearTestData();
  });

  test('same idempotency key reused for two create-order requests returns same order', async () => {
    const token = genTokenFor(userId);
    const idempotencyKey = `idemp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const body = {
      items: [{ product_id: productId, quantity: 1 }],
      shipping_address: { firstName: 'Test', lastName: 'User', email: 'test@example.com', phone: '9999999999', address: '123 Main St', city: 'X', state: 'YY', pinCode: '000000', paymentMethod: 'COD' },
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      paymentId: null,
      razorpayOrderId: null,
      razorpaySignature: null,
    };

    const [res1, res2] = await Promise.all([
      api.post('/api/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idempotencyKey).send(body),
      api.post('/api/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idempotencyKey).send(body),
    ]);

    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);
    const orderId1 = res1.body.order?.id || res1.body.order_id || res1.body.id;
    const orderId2 = res2.body.order?.id || res2.body.order_id || res2.body.id;
    expect(orderId1).toBeTruthy();
    expect(orderId1).toEqual(orderId2);

    const orders = await query('SELECT * FROM orders WHERE user_id = $1 AND payment_method = $2', [userId, 'cod']);
    expect(orders.rows.length).toBe(1);
  }, 20000);
});
