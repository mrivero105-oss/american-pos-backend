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
const ProductPresentation = require('./ProductPresentation');
const QuarantineSale = require('./QuarantineSale');
const ExchangeDifferenceLog = require('./ExchangeDifferenceLog');
const FiscalBookRecord = require('./FiscalBookRecord');
const TaxRetention = require('./TaxRetention');
const CreditNote = require('./CreditNote');
const Warehouse = require('./Warehouse');
const WarehouseStock = require('./WarehouseStock');
const StockTransfer = require('./StockTransfer');
const StockTransferItem = require('./StockTransferItem');
const PhysicalInventoryCount = require('./PhysicalInventoryCount');
const PriceList = require('./PriceList');
const ProductPrice = require('./ProductPrice');
const AccountingPeriod = require('./AccountingPeriod');
const SellerCommission = require('./SellerCommission');
const AccountCatalog = require('./AccountCatalog');
const JournalEntry = require('./JournalEntry');
const JournalEntryLine = require('./JournalEntryLine');
const Employee = require('./Employee');
const PayrollPeriod = require('./PayrollPeriod');
const PayrollReceipt = require('./PayrollReceipt');
const BillOfMaterials = require('./BillOfMaterials');
const BillOfMaterialsItem = require('./BillOfMaterialsItem');
const ProductionOrder = require('./ProductionOrder');
const CollectionActionLog = require('./CollectionActionLog');
const FixedAsset = require('./FixedAsset');
const AssetDepreciationLog = require('./AssetDepreciationLog');
const Promotion = require('./Promotion');
const StockAlert = require('./StockAlert');
const FiscalSequence = require('./FiscalSequence');
const TelecomRecharge = require('./TelecomRecharge');
const DailyRegisterSequence = require('./DailyRegisterSequence');
const RegisterDraft = require('./RegisterDraft');
const SyncOutbox = require('./SyncOutbox');
const BusinessSetting = require('./BusinessSetting');

// --- Relationships ---

// Warehouses & Stock Breakdown
Warehouse.hasMany(WarehouseStock, { foreignKey: 'warehouseId', as: 'Stocks', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
WarehouseStock.belongsTo(Warehouse, { foreignKey: 'warehouseId', as: 'Warehouse', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Product.hasMany(WarehouseStock, { foreignKey: 'productId', as: 'WarehouseStocks', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
WarehouseStock.belongsTo(Product, { foreignKey: 'productId', as: 'Product', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Stock Transfers
StockTransfer.hasMany(StockTransferItem, { foreignKey: 'stockTransferId', as: 'Items', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
StockTransferItem.belongsTo(StockTransfer, { foreignKey: 'stockTransferId', as: 'Transfer', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
StockTransfer.belongsTo(Warehouse, { foreignKey: 'fromWarehouseId', as: 'FromWarehouse', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
StockTransfer.belongsTo(Warehouse, { foreignKey: 'toWarehouseId', as: 'ToWarehouse', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Physical Inventory Counts
Warehouse.hasMany(PhysicalInventoryCount, { foreignKey: 'warehouseId', as: 'InventoryCounts', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
PhysicalInventoryCount.belongsTo(Warehouse, { foreignKey: 'warehouseId', as: 'Warehouse', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Price Lists & Custom Product Prices
PriceList.hasMany(ProductPrice, { foreignKey: 'priceListId', as: 'ProductPrices', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ProductPrice.belongsTo(PriceList, { foreignKey: 'priceListId', as: 'PriceList', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Product.hasMany(ProductPrice, { foreignKey: 'productId', as: 'CustomPrices', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ProductPrice.belongsTo(Product, { foreignKey: 'productId', as: 'Product', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Sales & Items & Refunds
Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'SaleItems', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
SaleItem.belongsTo(Sale, { foreignKey: 'saleId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Sale.hasMany(Refund, { foreignKey: 'saleId', as: 'Refunds', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Refund.belongsTo(Sale, { foreignKey: 'saleId', as: 'Sale', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Sale.belongsTo(Customer, { foreignKey: 'customerId', as: 'Customer', constraints: false });
Sale.belongsTo(User, { foreignKey: 'userId', as: 'User', constraints: false });
Sale.belongsTo(Branch, { foreignKey: 'branchId', as: 'Branch', constraints: false });
Customer.hasMany(Sale, { foreignKey: 'customerId', as: 'Sales', constraints: false });
Customer.hasMany(CreditHistory, { foreignKey: 'customerId', as: 'CreditHistories', constraints: false });
CreditHistory.belongsTo(Customer, { foreignKey: 'customerId', as: 'Customer', constraints: false });
PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplierId', as: 'Supplier', constraints: false });
Supplier.hasMany(PurchaseOrder, { foreignKey: 'supplierId', as: 'PurchaseOrders', constraints: false });

// Branches
Product.hasMany(BranchStock, { foreignKey: 'productId', as: 'BranchStocks', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
BranchStock.belongsTo(Product, { foreignKey: 'productId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Branch.hasMany(BranchStock, { foreignKey: 'branchId', as: 'Stocks', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BranchStock.belongsTo(Branch, { foreignKey: 'branchId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Lots & Variants
Product.hasMany(ProductPresentation, { foreignKey: 'productId', as: 'Presentations', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ProductPresentation.belongsTo(Product, { foreignKey: 'productId', as: 'Product', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Product.hasMany(ProductLot, { foreignKey: 'productId', as: 'Lots', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ProductLot.belongsTo(Product, { foreignKey: 'productId', as: 'Product', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ProductLot.belongsTo(Supplier, { foreignKey: 'supplierId', as: 'Supplier', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Supplier.hasMany(ProductLot, { foreignKey: 'supplierId', as: 'Lots', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

Product.hasMany(VarianteProducto, { foreignKey: 'producto_id', as: 'Variantes', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
VarianteProducto.belongsTo(Product, { foreignKey: 'producto_id', as: 'Producto', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Cash Management
CashShift.hasMany(CashMovement, { foreignKey: 'shiftId', as: 'CashMovements', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
CashMovement.belongsTo(CashShift, { foreignKey: 'shiftId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
CashShift.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

CashShift.hasMany(CashDeclaration, { foreignKey: 'shiftId', as: 'Declarations', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
CashShift.hasOne(CashDeclaration, { foreignKey: 'shiftId', as: 'Declaration', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
CashDeclaration.belongsTo(CashShift, { foreignKey: 'shiftId', as: 'Shift', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

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

// Audit & Alerts (constraints: false allows audit records to persist even for system actions or deleted/virtual users)
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'User', constraints: false });
Alert.belongsTo(User, { foreignKey: 'userId', as: 'user', constraints: false });

// Supervisor Approvals
SupervisorApproval.belongsTo(User, { foreignKey: 'performedBy', as: 'performer', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
SupervisorApproval.belongsTo(User, { foreignKey: 'approvedBy', as: 'approver', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Messages
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Accounting General & PUC
JournalEntry.hasMany(JournalEntryLine, { foreignKey: 'journalEntryId', as: 'Lines', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
JournalEntryLine.belongsTo(JournalEntry, { foreignKey: 'journalEntryId', as: 'Entry', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
AccountCatalog.hasMany(JournalEntryLine, { foreignKey: 'accountId', as: 'EntryLines', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
JournalEntryLine.belongsTo(AccountCatalog, { foreignKey: 'accountId', as: 'Account', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
AccountCatalog.hasMany(AccountCatalog, { foreignKey: 'parentId', as: 'Children', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
AccountCatalog.belongsTo(AccountCatalog, { foreignKey: 'parentId', as: 'Parent', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Payroll & HR
PayrollPeriod.hasMany(PayrollReceipt, { foreignKey: 'payrollPeriodId', as: 'Receipts', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PayrollReceipt.belongsTo(PayrollPeriod, { foreignKey: 'payrollPeriodId', as: 'Period', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Employee.hasMany(PayrollReceipt, { foreignKey: 'employeeId', as: 'Receipts', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
PayrollReceipt.belongsTo(Employee, { foreignKey: 'employeeId', as: 'Employee', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Employee.belongsTo(User, { foreignKey: 'userId', as: 'UserAccount', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

// Production & BOM
BillOfMaterials.belongsTo(Product, { foreignKey: 'targetProductId', as: 'TargetProduct', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Product.hasOne(BillOfMaterials, { foreignKey: 'targetProductId', as: 'BOM', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
BillOfMaterials.hasMany(BillOfMaterialsItem, { foreignKey: 'bomId', as: 'Items', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
BillOfMaterialsItem.belongsTo(BillOfMaterials, { foreignKey: 'bomId', as: 'BOM', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
BillOfMaterialsItem.belongsTo(Product, { foreignKey: 'componentProductId', as: 'ComponentProduct', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
ProductionOrder.belongsTo(BillOfMaterials, { foreignKey: 'bomId', as: 'BOM', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
ProductionOrder.belongsTo(Warehouse, { foreignKey: 'warehouseSourceId', as: 'SourceWarehouse', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
ProductionOrder.belongsTo(Warehouse, { foreignKey: 'warehouseDestId', as: 'DestWarehouse', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

// Collections & CRM
Customer.hasMany(CollectionActionLog, { foreignKey: 'customerId', as: 'CollectionActions', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
CollectionActionLog.belongsTo(Customer, { foreignKey: 'customerId', as: 'Customer', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Fixed Assets & Depreciation
FixedAsset.hasMany(AssetDepreciationLog, { foreignKey: 'assetId', as: 'Depreciations', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
AssetDepreciationLog.belongsTo(FixedAsset, { foreignKey: 'assetId', as: 'Asset', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
AssetDepreciationLog.belongsTo(JournalEntry, { foreignKey: 'journalEntryId', as: 'JournalEntry', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

// Stock Movements / Kardex / Waste
StockMovement.belongsTo(Product, { foreignKey: 'productId', as: 'Product', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Product.hasMany(StockMovement, { foreignKey: 'productId', as: 'StockMovements', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
StockMovement.belongsTo(User, { foreignKey: 'userId', as: 'User', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

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
    QuarantineSale,
    ExchangeDifferenceLog,
    FiscalBookRecord,
    TaxRetention,
    CreditNote,
    Warehouse,
    WarehouseStock,
    StockTransfer,
    StockTransferItem,
    PhysicalInventoryCount,
    PriceList,
    ProductPrice,
    ProductPresentation,
    AccountingPeriod,
    SellerCommission,
    AccountCatalog,
    JournalEntry,
    JournalEntryLine,
    Employee,
    PayrollPeriod,
    PayrollReceipt,
    BillOfMaterials,
    BillOfMaterialsItem,
    ProductionOrder,
    CollectionActionLog,
    FixedAsset,
    AssetDepreciationLog,
    Promotion,
    StockAlert,
    FiscalSequence,
    TelecomRecharge,
    DailyRegisterSequence,
    RegisterDraft,
    SyncOutbox,
    BusinessSetting
};
