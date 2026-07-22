import { query } from '../db/connection';
import logger from '../logger';

export interface OrderItemRequest {
  product_id: string;
  quantity: number;
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'packed'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'refunded';

export type RefundStatus = 'initiated' | 'processing' | 'completed';

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
  'dispatched',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'refunded',
];

export const CUSTOMER_CANCEL_ALLOWED_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'packed'];

export const MERCHANT_UPDATE_ALLOWED_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
  'dispatched',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'refunded',
];

export function normalizeOrderStatus(status: string): OrderStatus {
  const normalized = String(status || '').trim().toLowerCase();

  if (normalized === 'shipped') return 'dispatched';
  if (normalized === 'outfordelivery') return 'out_for_delivery';
  if (ORDER_STATUS_FLOW.includes(normalized as OrderStatus)) {
    return normalized as OrderStatus;
  }

  return 'pending';
}

export function canCustomerCancel(status: string): boolean {
  return CUSTOMER_CANCEL_ALLOWED_STATUSES.includes(normalizeOrderStatus(status));
}

export function addBusinessDays(startDate: Date, businessDays: number): Date {
  const result = new Date(startDate);
  let daysRemaining = businessDays;

  while (daysRemaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      daysRemaining -= 1;
    }
  }

  return result;
}

export function estimateDeliveryDate(createdAt: Date, estimatedDays = 5): string {
  return addBusinessDays(createdAt, Math.max(1, estimatedDays)).toISOString();
}

export function normalizeShippingAddress(address: any, fallbackEmail?: string) {
  if (!address || typeof address !== 'object') return null;

  const fullName = address.name?.trim() || `${address.firstName || ''} ${address.lastName || ''}`.trim();
  const [firstName, ...lastParts] = fullName.split(' ').filter(Boolean);
  const lastName = lastParts.join(' ');
  const email = address.email || address.email_address || fallbackEmail || '';

  return {
    firstName: firstName || '',
    lastName: lastName || '',
    email,
    phone: address.phone || address.phoneNumber || '',
    address: address.address || address.street || '',
    city: address.city || '',
    state: address.state || '',
    pinCode: address.pinCode || address.pincode || address.postalCode || '',
    rawName: fullName,
  };
}

export function buildShippingAddressSnapshot(address: any) {
  const normalized = normalizeShippingAddress(address);
  return {
    name: `${normalized?.firstName || ''} ${normalized?.lastName || ''}`.trim() || normalized?.rawName || '',
    phone: normalized?.phone || '',
    address: normalized?.address || '',
    city: normalized?.city || '',
    state: normalized?.state || '',
    pincode: normalized?.pinCode || '',
    email: normalized?.email || '',
  };
}

export async function loadProductSnapshots(productIds: string[]) {
  if (productIds.length === 0) {
    return [] as any[];
  }

  const placeholders = productIds.map((_, index) => `$${index + 1}`).join(', ');
  const result = await query(
    `SELECT id, merchant_id, name, price, image_url, imgs, size_stock, stock, estimated_delivery_days
     FROM products
     WHERE id IN (${placeholders})`,
    productIds
  );

  return result.rows;
}

export function buildProductSnapshot(product: any, quantity: number, requestedSize?: string | null, requestedColor?: string | null) {
  const imageUrl = Array.isArray(product?.imgs) && product.imgs.length > 0
    ? product.imgs[0]
    : product?.image_url || null;

  return {
    product_id: product.id,
    name: product.name,
    price: Number(product.price || 0),
    image_url: imageUrl,
    size: requestedSize || null,
    color: requestedColor || null,
    quantity,
  };
}

export function buildOrderItemSnapshot(product: any, quantity: number, requestedSize?: string | null, requestedColor?: string | null) {
  return {
    product_id: product.id,
    product_name: product.name,
    product_price: Number(product.price || 0),
    product_image: Array.isArray(product?.imgs) && product.imgs.length > 0 ? product.imgs[0] : product?.image_url || null,
    size: requestedSize || null,
    color: requestedColor || null,
    quantity,
  };
}

export function buildRefundWindow(): { expectedRefundDate: string } {
  const date = addBusinessDays(new Date(), 10);
  return { expectedRefundDate: date.toISOString() };
}

export async function getLatestStatusHistory(orderId: string) {
  const result = await query(
    `SELECT id, order_id, previous_status, new_status, note, changed_by, changed_by_role, created_at
     FROM order_status_history
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [orderId]
  );

  return result.rows;
}

export function validateShippingAddress(address: any, fallbackEmail?: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const normalized = normalizeShippingAddress(address, fallbackEmail);

  if (!normalized) {
    return { valid: false, errors: ['Invalid shipping address'] };
  }

  if (!normalized.firstName || normalized.firstName.length < 2) {
    errors.push('Invalid name');
  }
  if (!normalized.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.push('Invalid email');
  }
  if (!normalized.phone || !/^[0-9]{10}$/.test(normalized.phone)) {
    errors.push('Invalid phone number');
  }
  if (!normalized.address || normalized.address.length < 3) {
    errors.push('Invalid address');
  }
  if (!normalized.city || normalized.city.length < 1) {
    errors.push('Invalid city');
  }
  if (!normalized.state || normalized.state.length < 1) {
    errors.push('Invalid state');
  }
  if (!normalized.pinCode || !/^[0-9]{6}$/.test(normalized.pinCode)) {
    errors.push('Invalid PIN code');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function checkProductStock(productId: string, quantity: number): Promise<boolean> {
  try {
    const result = await query('SELECT stock FROM products WHERE id = $1', [productId]);
    if (result.rows.length === 0) return false;
    const stock = result.rows[0].stock;
    if (typeof stock === 'number') {
      return stock >= quantity;
    }
    return true;
  } catch (error) {
    logger.error('Stock check error:', error);
    return false;
  }
}

export async function calculateItemSubtotal(
  items: OrderItemRequest[]
): Promise<{ valid: true; subtotal: number } | { valid: false; error: string }> {
  let subtotal = 0;

  for (const item of items) {
    const productResult = await query('SELECT price FROM products WHERE id = $1', [item.product_id]);
    if (productResult.rows.length === 0) {
      return { valid: false, error: `Product ${item.product_id} not found` };
    }

    const priceRaw = productResult.rows[0].price;
    const price = typeof priceRaw === 'string' ? parseFloat(priceRaw) : Number(priceRaw);
    if (Number.isNaN(price)) {
      return { valid: false, error: `Invalid price for product ${item.product_id}` };
    }

    subtotal += price * item.quantity;
  }

  return { valid: true, subtotal };
}

export function calculateOrderAmounts(subtotal: number) {
  const taxAmount = Number((subtotal * 0.05).toFixed(2));
  const totalAmount = Number((subtotal + taxAmount).toFixed(2));
  return { subtotal, taxAmount, totalAmount };
}
