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

describe('Stock race conditions', () => {
  let userA: string;
  let userB: string;
  let merchantId: string;
  let productId: string;

  beforeAll(async () => {
    await createTables();
    await clearTestData();
    merchantId = await createTestMerchant('test-merchant-stock');
    userA = await createTestUser('test-user-stock-a');
    userB = await createTestUser('test-user-stock-b');
    productId = await createTestProduct(merchantId, { price: 200, stock: 1 });
  });

  afterAll(async () => {
    await clearTestData();
  });

  test('only one of two simultaneous COD orders succeeds when stock=1', async () => {
    const tokenA = genTokenFor(userA);
    const tokenB = genTokenFor(userB);

    const body = {
      items: [{ product_id: productId, quantity: 1 }],
      shipping_address: { name: 'T', email: 't@example.com', phone: '999', address: 'x', city: 'y', state: 'z', pincode: '000' },
      payment_method: 'COD'
    };

    const reqA = api.post('/api/orders').set('Authorization', `Bearer ${tokenA}`).send(body);
    const reqB = api.post('/api/orders').set('Authorization', `Bearer ${tokenB}`).send(body);

    const results = await Promise.allSettled([reqA, reqB]);
    const fulfilled = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value);
    // At least one should succeed
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const prod = await query('SELECT stock FROM products WHERE id = $1', [productId]);
    // stock should be 0
    expect(Number(prod.rows[0].stock)).toBe(0);

    const orders = await query('SELECT * FROM orders WHERE id IS NOT NULL AND (order_snapshot IS NOT NULL OR total_amount IS NOT NULL)');
    // There should be exactly 1 order referencing this product (basic check)
    const related = await query('SELECT o.* FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE oi.product_id = $1', [productId]);
    expect(related.rows.length).toBe(1);
  }, 20000);

});
