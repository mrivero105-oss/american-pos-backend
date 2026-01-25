-- Add missing columns to sales table
ALTER TABLE sales ADD COLUMN date TEXT;
ALTER TABLE sales ADD COLUMN customerName TEXT;
ALTER TABLE sales ADD COLUMN userId TEXT;

-- Add missing columns to products table
ALTER TABLE products ADD COLUMN userId TEXT;
-- Add isSoldByWeight to products if missing (saw it in POST /products)
ALTER TABLE products ADD COLUMN isSoldByWeight INTEGER DEFAULT 0;
