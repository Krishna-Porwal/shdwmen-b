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

describe('E2E integration tests', () => {
  let userId: string;
  let merchantId: string;
  let productId: string;
  let orderId: string;

  beforeAll(async () => {
    // ensure DB schema
    await createTables();
    await clearTestData();
  }, 20000);

  afterAll(async () => {
    await clearTestData();
  });

  test('COD flow: place order reduces stock and increments sold_count', async () => {
    merchantId = await createTestMerchant('test-merchant-e2e');
    userId = await createTestUser('test-user-e2e');
    productId = await createTestProduct(merchantId, { price: 150, stock: 5 });

    const token = genTokenFor(userId, 'customer');

    const body = {
      items: [{ product_id: productId, quantity: 2, price: 150 }],
      shipping_address: { name: 'Test User', email: 'test@example.com', phone: '9999999999', address: '123 Main Street', city: 'X', state: 'YY', pincode: '000000' },
      payment_method: 'COD'
    };

    const res = await api.post('/api/orders').set('Authorization', `Bearer ${token}`).send(body);
    expect([200, 201]).toContain(res.status);
    const created = res.body.order || res.body;
    orderId = created.id || (created.order && created.order.id) || res.body.order?.id;
    expect(orderId).toBeTruthy();

    // verify product stock decreased
    const prod = await query('SELECT stock, sold_count FROM products WHERE id = $1', [productId]);
    expect(prod.rows.length).toBe(1);
    expect(prod.rows[0].stock).toBe(3);
    expect(Number(prod.rows[0].sold_count)).toBe(2);
  }, 20000);

  test('Customer cancellation restores inventory and updates order', async () => {
    const token = genTokenFor(userId, 'customer');
    const res = await api.post(`/api/orders/${orderId}/cancel`).set('Authorization', `Bearer ${token}`).send({ cancelReason: 'Changed my mind', cancelReasonType: 'other' });
    expect([200,201,204]).toContain(res.status);

    const prod = await query('SELECT stock, sold_count FROM products WHERE id = $1', [productId]);
    expect(prod.rows[0].stock).toBe(5);
    expect(Number(prod.rows[0].sold_count)).toBe(0);

    const order = await query('SELECT status, cancelled_by, cancel_reason FROM orders WHERE id = $1', [orderId]);
    expect(order.rows[0].status).toBe('cancelled');
    expect(order.rows[0].cancelled_by).toBe('customer');
    expect(order.rows[0].cancel_reason).toBe('Changed my mind');
  }, 20000);

  test('Merchant cancellation can cancel any order and triggers inventory restore', async () => {
    // create new order to cancel by merchant
    const newOrderId = await createTestOrder(userId, productId, merchantId, { quantity: 1, price: 150, status: 'pending', payment_method: 'cod' });
    // decrease stock and increment sold_count to simulate placement
    await query('UPDATE products SET stock = stock - 1, sold_count = sold_count + 1 WHERE id = $1', [productId]);

    const merchantToken = genTokenFor(merchantId, 'merchant');
    const res = await api.patch(`/api/orders/${newOrderId}/status`).set('Authorization', `Bearer ${merchantToken}`).send({ status: 'cancelled', cancelReason: 'Out of stock', cancelReasonType: 'inventory' });
    expect([200,201,204]).toContain(res.status);

    const prod = await query('SELECT stock, sold_count FROM products WHERE id = $1', [productId]);
    expect(prod.rows[0].stock).toBe(5);
    expect(Number(prod.rows[0].sold_count)).toBe(0);

    const order = await query('SELECT status, cancelled_by, cancel_reason FROM orders WHERE id = $1', [newOrderId]);
    expect(order.rows[0].status).toBe('cancelled');
    expect(order.rows[0].cancelled_by).toBe('merchant');
    expect(order.rows[0].cancel_reason).toBe('Out of stock');
  }, 20000);

  test('Dashboard analytics reflect orders and cancellations', async () => {
    const merchantToken = genTokenFor(merchantId, 'merchant');
    const res = await api.get('/api/merchant/dashboard/stats').set('Authorization', `Bearer ${merchantToken}`);
    expect(res.status).toBe(200);
    const stats = res.body;
    expect(stats).toHaveProperty('totalOrders');
    expect(stats).toHaveProperty('cancelledOrders');
  });

});
