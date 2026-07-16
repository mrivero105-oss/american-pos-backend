-- Add columns for Multi-Tenancy

-- Users Table Updates
-- ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
-- ALTER TABLE users ADD COLUMN businessInfo TEXT; -- JSON string for currency settings, etc.

-- Data Isolation Columns
-- ALTER TABLE products ADD COLUMN userId TEXT;
-- ALTER TABLE customers ADD COLUMN userId TEXT;
-- ALTER TABLE sales ADD COLUMN userId TEXT;

-- Indexing for performance
-- CREATE INDEX IF NOT EXISTS idx_products_userId ON products(userId);
-- CREATE INDEX IF NOT EXISTS idx_customers_userId ON customers(userId);
-- CREATE INDEX IF NOT EXISTS idx_sales_userId ON sales(userId);
