-- Add userId to payment_methods
ALTER TABLE payment_methods ADD COLUMN userId TEXT;
CREATE INDEX IF NOT EXISTS idx_payment_methods_userId ON payment_methods(userId);
