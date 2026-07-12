-- Migration: add sold_count to products and ensure refunds table + indexes
-- Idempotent statements so this can be run safely against existing DBs

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sold_count INT DEFAULT 0;

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
  refund_id VARCHAR(255) UNIQUE,
  refund_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  refund_status VARCHAR(50) NOT NULL DEFAULT 'initiated',
  refund_initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expected_refund_date TIMESTAMP,
  refund_completed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

-- Useful indexes for order queries
CREATE INDEX IF NOT EXISTS idx_orders_user_status_created ON orders(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);
