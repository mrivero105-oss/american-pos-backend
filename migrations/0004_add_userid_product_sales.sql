-- Add userId to resource tables
-- ALTER TABLE products ADD COLUMN userId TEXT;
-- ALTER TABLE customers ADD COLUMN userId TEXT;
-- ALTER TABLE sales ADD COLUMN userId TEXT;

-- CREATE INDEX IF NOT EXISTS idx_products_userId ON products(userId);
-- CREATE INDEX IF NOT EXISTS idx_customers_userId ON customers(userId);
-- CREATE INDEX IF NOT EXISTS idx_sales_userId ON sales(userId);
