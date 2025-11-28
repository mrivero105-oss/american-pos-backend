DROP TABLE IF EXISTS sale_items;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS payment_methods;

CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    priceBs REAL,
    stockQuantity INTEGER DEFAULT 0,
    category TEXT,
    barcode TEXT,
    imageUri TEXT,
    isCustom INTEGER DEFAULT 0
);

CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    idDocument TEXT,
    phone TEXT,
    email TEXT,
    address TEXT
);

CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    total REAL NOT NULL,
    exchangeRate REAL NOT NULL,
    paymentMethod TEXT,
    customerId TEXT,
    FOREIGN KEY (customerId) REFERENCES customers(id)
);

CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    saleId TEXT NOT NULL,
    productId TEXT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (saleId) REFERENCES sales(id),
    FOREIGN KEY (productId) REFERENCES products(id)
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE payment_methods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL
);

-- Initialize default settings
INSERT INTO settings (key, value) VALUES ('exchangeRate', '1.0');
INSERT INTO settings (key, value) VALUES ('businessInfo', '{}');
