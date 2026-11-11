const { Product, BranchStock, Supplier } = require('../database/models');
const { connectDB } = require('../database/connection');
const ProductService = require('./ProductService');

const test = async () => {
    await connectDB();
    console.log('Testing ProductService.getAllProducts speed...');
    
    // Test 1: Full load without limits (what we think the frontend might be doing)
    const start1 = Date.now();
    const result1 = await ProductService.getAllProducts({ companyId: '2' }, {}); // Assumed companyId
    const end1 = Date.now();
    console.log(`Test 1: Full load (847 products) took ${end1 - start1}ms`);
    
    // Test 2: Minimal load (how it SHOULD be done for sync)
    const start2 = Date.now();
    const result2 = await ProductService.getAllProducts({ companyId: '2' }, { minimal: 'true' });
    const end2 = Date.now();
    console.log(`Test 2: Minimal load took ${end2 - start2}ms`);
    
    // Test 3: Pagination
    const start3 = Date.now();
    const result3 = await ProductService.getAllProducts({ companyId: '2' }, { page: 1, limit: 20 });
    const end3 = Date.now();
    console.log(`Test 3: Paginated load (20 items) took ${end3 - start3}ms`);
};

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
