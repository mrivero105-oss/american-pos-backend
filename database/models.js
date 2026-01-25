const { DataTypes } = require('sequelize');
const { sequelize } = require('./connection');

const Product = sequelize.define('Product', {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING },
    price: { type: DataTypes.FLOAT },
    stock: { type: DataTypes.FLOAT },
    category: { type: DataTypes.STRING },
    barcode: { type: DataTypes.STRING },
    imageUri: { type: DataTypes.STRING },
    isSoldByWeight: { type: DataTypes.BOOLEAN, defaultValue: false },
    cost: { type: DataTypes.FLOAT },
    priceBs: { type: DataTypes.FLOAT },
    stockQuantity: { type: DataTypes.FLOAT },
    userId: { type: DataTypes.STRING },
    isCustom: { type: DataTypes.BOOLEAN, defaultValue: false }
});

const Customer = sequelize.define('Customer', {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING },
    idDocument: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    address: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    creditLimit: { type: DataTypes.FLOAT, defaultValue: 0 },
    creditBalance: { type: DataTypes.FLOAT, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const Sale = sequelize.define('Sale', {
    id: { type: DataTypes.STRING, primaryKey: true },
    date: { type: DataTypes.STRING }, // Keeping as string to match JSON iso format
    total: { type: DataTypes.FLOAT },
    items: { type: DataTypes.JSON }, // Storing items array as JSON
    paymentMethod: { type: DataTypes.STRING }, // JSON object of methods
    subtotal: { type: DataTypes.FLOAT },
    tax: { type: DataTypes.FLOAT },
    discount: { type: DataTypes.FLOAT },
    customerId: { type: DataTypes.STRING },
    customerName: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING, defaultValue: 'completed' },
    exchangeRate: { type: DataTypes.FLOAT } // Exchange rate at time of sale
});

const User = sequelize.define('User', {
    id: { type: DataTypes.STRING, primaryKey: true },
    username: { type: DataTypes.STRING },
    password: { type: DataTypes.STRING },
    role: { type: DataTypes.STRING },
    name: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING, defaultValue: 'active' },
    trial_expires_at: { type: DataTypes.STRING }
});

const Supplier = sequelize.define('Supplier', {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING },
    contact: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    address: { type: DataTypes.STRING },
    notes: { type: DataTypes.TEXT },
    userId: { type: DataTypes.STRING }
});

const CashShift = sequelize.define('CashShift', {
    id: { type: DataTypes.STRING, primaryKey: true },
    openedAt: { type: DataTypes.STRING },
    closedAt: { type: DataTypes.STRING },
    startingCash: { type: DataTypes.FLOAT, field: 'initialAmount' },
    actualCash: { type: DataTypes.FLOAT, field: 'finalAmount' },
    expectedCash: { type: DataTypes.FLOAT, field: 'expectedAmount' },
    difference: { type: DataTypes.FLOAT },
    status: { type: DataTypes.STRING }, // 'open', 'closed'
    userId: { type: DataTypes.STRING },
    userName: { type: DataTypes.STRING },
    movements: { type: DataTypes.JSON }, // cash in/out events
    salesSummary: { type: DataTypes.JSON }
});

const PurchaseOrder = sequelize.define('PurchaseOrder', {
    id: { type: DataTypes.STRING, primaryKey: true },
    supplierId: { type: DataTypes.STRING },
    date: { type: DataTypes.STRING },
    expectedDate: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING }, // 'ordered', 'received', 'cancelled'
    total: { type: DataTypes.FLOAT },
    items: { type: DataTypes.JSON },
    notes: { type: DataTypes.TEXT },
    userId: { type: DataTypes.STRING },
    createdAt: { type: DataTypes.STRING }
});

// Defining simple models for other entities if needed, or keeping them as JSON blobs in a diverse storage if they are unstructured.
// For now, let's map the core ones identified.

// Refunds/Returns
const Refund = sequelize.define('Refund', {
    id: { type: DataTypes.STRING, primaryKey: true },
    saleId: { type: DataTypes.STRING },
    date: { type: DataTypes.STRING },
    reason: { type: DataTypes.STRING },
    amount: { type: DataTypes.FLOAT },
    items: { type: DataTypes.JSON }
});

// Credit History (for customer tabs)
const CreditHistory = sequelize.define('CreditHistory', {
    id: { type: DataTypes.STRING, primaryKey: true },
    customerId: { type: DataTypes.STRING },
    userId: { type: DataTypes.STRING },
    timestamp: { type: DataTypes.STRING }, // or date
    type: { type: DataTypes.STRING }, // 'charge', 'payment'
    amount: { type: DataTypes.FLOAT },
    balanceAfter: { type: DataTypes.FLOAT },
    description: { type: DataTypes.STRING },
    paymentMethod: { type: DataTypes.STRING }
});

module.exports = {
    Product,
    Customer,
    Sale,
    User,
    Supplier,
    CashShift,
    Refund,
    CreditHistory,
    PurchaseOrder
};
