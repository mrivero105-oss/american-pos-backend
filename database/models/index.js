const Product = require('./Product');
const ProductLot = require('./ProductLot');
const Customer = require('./Customer');
const Sale = require('./Sale');
const User = require('./User');
const Supplier = require('./Supplier');
const CashShift = require('./CashShift');
const Refund = require('./Refund');
const CreditHistory = require('./CreditHistory');
const PurchaseOrder = require('./PurchaseOrder');
const License = require('./License');
const StockMovement = require('./StockMovement');
const Expense = require('./Expense');
const SaleItem = require('./SaleItem');
const AuditLog = require('./AuditLog');
const CashMovement = require('./CashMovement');
const Branch = require('./Branch');
const BranchStock = require('./BranchStock');
const SupplierCreditHistory = require('./SupplierCreditHistory');
const Quotation = require('./Quotation');
const SupplierProductMapping = require('./SupplierProductMapping');
const CashDeclaration = require('./CashDeclaration');
const Alert = require('./Alert');
const SupervisorApproval = require('./SupervisorApproval');
const ServiceOrder = require('./ServiceOrder');
const Message = require('./Message');
const PrincipioActivo = require('./PrincipioActivo');
const VarianteProducto = require('./VarianteProducto');
const QuarantineSale = require('./QuarantineSale');

// --- Relationships ---

// Sales & Items
Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'SaleItems', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
SaleItem.belongsTo(Sale, { foreignKey: 'saleId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Branches
Product.hasMany(BranchStock, { foreignKey: 'productId', as: 'BranchStocks', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BranchStock.belongsTo(Product, { foreignKey: 'productId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Branch.hasMany(BranchStock, { foreignKey: 'branchId', as: 'Stocks', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BranchStock.belongsTo(Branch, { foreignKey: 'branchId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Lots & Variants
Product.hasMany(ProductLot, { foreignKey: 'productId', as: 'Lots', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ProductLot.belongsTo(Product, { foreignKey: 'productId', as: 'Product', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Product.hasMany(VarianteProducto, { foreignKey: 'producto_id', as: 'Variantes', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
VarianteProducto.belongsTo(Product, { foreignKey: 'producto_id', as: 'Producto', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Cash Management
CashShift.hasMany(CashMovement, { foreignKey: 'shiftId', as: 'CashMovements', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
CashMovement.belongsTo(CashShift, { foreignKey: 'shiftId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
CashShift.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

CashShift.hasOne(CashDeclaration, { foreignKey: 'shiftId', as: 'Declaration', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
CashDeclaration.belongsTo(CashShift, { foreignKey: 'shiftId', as: 'Shift', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Suppliers & Products
Product.belongsTo(Supplier, { foreignKey: 'supplierId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Supplier.hasMany(Product, { foreignKey: 'supplierId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
SupplierProductMapping.belongsTo(Product, { foreignKey: 'localProductId', as: 'Product', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Product.hasMany(SupplierProductMapping, { foreignKey: 'localProductId', as: 'Mappings', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
SupplierProductMapping.belongsTo(Supplier, { foreignKey: 'supplierId', as: 'Supplier', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Credit History
Supplier.hasMany(SupplierCreditHistory, { foreignKey: 'supplierId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
SupplierCreditHistory.belongsTo(Supplier, { foreignKey: 'supplierId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Quotations
Quotation.belongsTo(Customer, { foreignKey: 'customerId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Customer.hasMany(Quotation, { foreignKey: 'customerId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Service Orders
ServiceOrder.belongsTo(Customer, { foreignKey: 'customerId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Customer.hasMany(ServiceOrder, { foreignKey: 'customerId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Audit
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'User', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Alert.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Supervisor Approvals
SupervisorApproval.belongsTo(User, { foreignKey: 'performedBy', as: 'performer', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
SupervisorApproval.belongsTo(User, { foreignKey: 'approvedBy', as: 'approver', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Messages
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

module.exports = {
    Product,
    Customer,
    Sale,
    User,
    Supplier,
    CashShift,
    Refund,
    CreditHistory,
    PurchaseOrder,
    License,
    StockMovement,
    Expense,
    SaleItem,
    AuditLog,
    CashMovement,
    Branch,
    BranchStock,
    SupplierCreditHistory,
    Quotation,
    SupplierProductMapping,
    CashDeclaration,
    Alert,
    SupervisorApproval,
    ServiceOrder,
    Message,
    ProductLot,
    PrincipioActivo,
    VarianteProducto,
    QuarantineSale
};
