-- Backfill sold_count from order_items, excluding cancelled orders
BEGIN;

-- Ensure sold_count column exists
ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_count INT DEFAULT 0;

-- Update sold_count based on successful (non-cancelled) orders
UPDATE products
SET sold_count = COALESCE(sub.sum_qty, 0)
FROM (
  SELECT oi.product_id, SUM(oi.quantity) as sum_qty
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.status != 'cancelled'
  GROUP BY oi.product_id
) as sub
WHERE products.id = sub.product_id;

-- Set sold_count to 0 for products with no orders
UPDATE products
SET sold_count = 0
WHERE id NOT IN (SELECT DISTINCT product_id FROM order_items);

COMMIT;
