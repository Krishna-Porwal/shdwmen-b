import { query } from '../db/connection';

export interface OrderItemRequest {
  product_id: string;
  quantity: number;
}

export function validateShippingAddress(address: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!address?.firstName || address.firstName.length < 2) errors.push('Invalid first name');
  if (!address?.lastName || address.lastName.length < 2) errors.push('Invalid last name');
  if (!address?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) errors.push('Invalid email');
  if (!address?.phone || !/^[0-9]{10}$/.test(address.phone)) errors.push('Invalid phone number');
  if (!address?.address || address.address.length < 5) errors.push('Invalid address');
  if (!address?.city || address.city.length < 2) errors.push('Invalid city');
  if (!address?.state || address.state.length < 2) errors.push('Invalid state');
  if (!address?.pinCode || !/^[0-9]{6}$/.test(address.pinCode)) errors.push('Invalid PIN code');

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
    console.error('Stock check error:', error);
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
  const taxAmount = Number((subtotal * 0.18).toFixed(2));
  const totalAmount = Number((subtotal + taxAmount).toFixed(2));
  return { subtotal, taxAmount, totalAmount };
}
