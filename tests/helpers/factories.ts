import { query } from '../../src/db/connection';
import { v4 as uuidv4 } from 'uuid';

export async function clearTestData() {
  await query('DELETE FROM order_items');
  await query('DELETE FROM orders');
  await query('DELETE FROM products');
  await query("DELETE FROM users WHERE id LIKE 'test-%'");
}

export async function createTestUser(id?: string) {
  const userId = id || `test-user-${uuidv4()}`;
  await query(`INSERT INTO users (id, name, email, password, role) VALUES ($1,$2,$3,$4,'customer') ON CONFLICT (id) DO NOTHING`, [userId, 'Test User', `${userId}@example.com`, 'password']);
  return userId;
}

export async function createTestMerchant(id?: string) {
  const merchantId = id || `test-merchant-${uuidv4()}`;
  await query(`INSERT INTO users (id, name, email, password, role, shop_name, owner_name) VALUES ($1,$2,$3,$4,'merchant','Test Shop','Owner') ON CONFLICT (id) DO NOTHING`, [merchantId, 'Merchant', `${merchantId}@example.com`, 'password']);
  return merchantId;
}

export async function createTestProduct(merchantId: string, overrides?: any) {
  const id = overrides?.id || uuidv4();
  const name = overrides?.name || 'Test Product';
  const price = overrides?.price ?? 100;
  const stock = overrides?.stock ?? 10;
  await query(`INSERT INTO products (id, merchant_id, name, price, stock, sold_count) VALUES ($1,$2,$3,$4,$5,0) ON CONFLICT (id) DO NOTHING`, [id, merchantId, name, price, stock]);
  return id;
}

export async function createTestOrder(userId: string, productId: string, merchantId: string, opts?: any) {
  const orderId = uuidv4();
  const qty = opts?.quantity || 1;
  const total = (opts?.price || 100) * qty;
  await query(`INSERT INTO orders (id, user_id, total_amount, status, payment_method, created_at) VALUES ($1,$2,$3,$4,$5,NOW())`, [orderId, userId, total, opts?.status || 'pending', opts?.payment_method || 'cod']);
  await query(`INSERT INTO order_items (id, order_id, product_id, quantity, price, product_snapshot) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`, [orderId, productId, qty, opts?.price || 100, JSON.stringify({ product_name: 'Test Product' })]);
  return orderId;
}
