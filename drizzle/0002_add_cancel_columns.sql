-- Migration: add order cancellation columns

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancel_reason_type VARCHAR(255);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(255);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
