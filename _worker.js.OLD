
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // CORS Headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS, PUT, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // --- Helper Functions ---
        const jsonResponse = (data, status = 200) => {
            return new Response(JSON.stringify(data), {
                status: status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        };

        const errorResponse = (msg, status = 500) => {
            return jsonResponse({ error: msg }, status);
        };

        const readJson = async (key) => {
            try {
                const stmt = env.DB.prepare('SELECT value FROM kv_store WHERE key = ?').bind(key);
                const result = await stmt.first();
                return result ? JSON.parse(result.value) : null;
            } catch (e) {
                console.error(`Error reading ${key}:`, e);
                return null;
            }
        };

        const writeJson = async (key, data) => {
            try {
                const value = JSON.stringify(data);
                const stmt = env.DB.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').bind(key, value);
                await stmt.run();
                return true;
            } catch (e) {
                console.error(`Error writing ${key}:`, e);
                return false;
            }
        };

        // --- Auth Middleware Logic ---
        const verifyToken = (req) => {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader) return null;
            const token = authHeader.split(' ')[1];
            if (!token) return null;
            if (token.startsWith('user:')) {
                const parts = token.split(':');
                if (parts.length >= 2) return { id: parts[1] };
            }
            return null;
        };

        // --- Handlers ---
        try {
            // LOGIN
            if (url.pathname === '/auth/login' && request.method === 'POST') {
                const body = await request.json();
                const { email, password } = body;
                if (!email || !password) return errorResponse('Faltan credenciales', 400);

                const db = (await readJson('db')) || { users: [] };
                if (!db.users) db.users = [];

                // Simple auth check
                const user = db.users.find(u => u.email === email && u.password === password);
                if (user) {
                    if (user.status === 'blocked') return errorResponse('Tu cuenta ha sido bloqueada', 401);
                    if (user.trial_expires_at && new Date() > new Date(user.trial_expires_at)) {
                        return errorResponse('Tu periodo de prueba ha expirado', 401);
                    }
                    const { password: _, ...userWithoutPassword } = user;
                    return jsonResponse({
                        success: true,
                        token: `user:${user.id}:${Date.now()}`,
                        user: userWithoutPassword
                    });
                }
                return errorResponse('Credenciales inválidas', 401);
            }

            // Products
            if (url.pathname === '/products') {
                if (request.method === 'GET') {
                    const db = (await readJson('db')) || { products: [] };
                    const user = verifyToken(request);
                    let tenantId = 'admin-1';
                    if (user && db.users) {
                        const u = db.users.find(u => u.id === user.id);
                        if (u) tenantId = u.tenantId || 'admin-1';
                    }
                    let products = (db.products || []).filter(p => p.tenantId === tenantId || (!p.tenantId && tenantId === 'admin-1'));

                    // Search filter
                    const search = url.searchParams.get('search');
                    if (search) {
                        const searchLower = search.toLowerCase();
                        products = products.filter(p =>
                            p.name.toLowerCase().includes(searchLower) ||
                            (p.barcode && p.barcode.toLowerCase().includes(searchLower)) ||
                            (p.category && p.category.toLowerCase().includes(searchLower))
                        );
                    }

                    // Category filter
                    const category = url.searchParams.get('category');
                    if (category) {
                        products = products.filter(p => p.category === category);
                    }

                    // Pagination
                    const page = parseInt(url.searchParams.get('page')) || 1;
                    const limit = parseInt(url.searchParams.get('limit')) || 0;

                    if (limit > 0) {
                        const startIndex = (page - 1) * limit;
                        const endIndex = startIndex + limit;
                        const paginatedProducts = products.slice(startIndex, endIndex);

                        return jsonResponse({
                            products: paginatedProducts,
                            total: products.length,
                            page,
                            totalPages: Math.ceil(products.length / limit)
                        });
                    }

                    return jsonResponse(products);
                }
                // Verify Token for updates
                const user = verifyToken(request);
                if (!user) return errorResponse('No autenticado', 401);

                if (request.method === 'POST') {
                    const body = await request.json();

                    const db = (await readJson('db')) || { products: [] }; // Ensure DB loaded
                    if (!db.products) db.products = [];

                    // Tenant ID Logic for Create
                    let tenantId = 'admin-1';
                    if (db.users) {
                        const u = db.users.find(u => u.id === user.id);
                        if (u) tenantId = u.tenantId || 'admin-1';
                    }

                    const newProduct = {
                        ...body,
                        id: body.id || Date.now().toString(), // Fallback ID
                        tenantId: tenantId,
                        createdAt: new Date().toISOString()
                    };

                    db.products.push(newProduct);
                    await writeJson('db', db);
                    return jsonResponse(newProduct, 201);
                }
            }

            // Products Categories
            if (url.pathname === '/products/categories') {
                if (request.method === 'GET') {
                    const db = (await readJson('db')) || { products: [] };
                    const user = verifyToken(request);
                    let tenantId = 'admin-1';
                    if (user && db.users) {
                        const u = db.users.find(u => u.id === user.id);
                        if (u) tenantId = u.tenantId || 'admin-1';
                    }
                    const products = (db.products || []).filter(p => p.tenantId === tenantId || (!p.tenantId && tenantId === 'admin-1'));

                    // Extract unique categories with counts
                    const counts = {};
                    products.forEach(p => {
                        const cat = p.category || 'General';
                        counts[cat] = (counts[cat] || 0) + 1;
                    });

                    return jsonResponse({
                        counts: counts,
                        total: products.length
                    });
                }
            }

            // Products by ID (PUT, DELETE)
            if (url.pathname.startsWith('/products/')) {
                const id = url.pathname.split('/').pop();
                const user = verifyToken(request);
                if (!user) return errorResponse('No autenticado', 401);

                const db = (await readJson('db')) || { products: [] };
                let tenantId = 'admin-1';
                if (db.users) {
                    const u = db.users.find(u => u.id === user.id);
                    if (u) tenantId = u.tenantId || 'admin-1';
                }

                if (request.method === 'PUT') {
                    const body = await request.json();
                    const index = db.products.findIndex(p => p.id === id);
                    if (index === -1) return errorResponse('Producto no encontrado', 404);

                    db.products[index] = { ...db.products[index], ...body, id }; // Ensure ID matches
                    await writeJson('db', db);
                    return jsonResponse(db.products[index]);
                }

                if (request.method === 'DELETE') {
                    const initialLength = db.products.length;
                    db.products = db.products.filter(p => p.id !== id);

                    if (db.products.length === initialLength) return errorResponse('Producto no encontrado', 404);

                    await writeJson('db', db);
                    return jsonResponse({ success: true });
                }
            }

            const user = verifyToken(request);

            // Settings/Business
            if (url.pathname === '/settings/business') {
                const settings = (await readJson('settings')) || {};
                const userId = user ? user.id : 'admin-1';

                if (request.method === 'GET') {
                    const userSettings = settings[userId] || {};
                    return jsonResponse(userSettings.businessInfo || {});
                }

                if (request.method === 'POST') {
                    if (!user) return errorResponse('No autenticado', 401);
                    const body = await request.json();
                    if (!settings[userId]) settings[userId] = {};
                    settings[userId].businessInfo = { ...settings[userId].businessInfo, ...body };
                    await writeJson('settings', settings);
                    return jsonResponse({ success: true, businessInfo: settings[userId].businessInfo });
                }
            }

            if (url.pathname === '/settings/rate') { // Exchange Rate
                const settings = (await readJson('settings')) || {};
                const userId = user ? user.id : 'admin-1';

                if (request.method === 'GET') {
                    const userSettings = settings[userId] || {};
                    return jsonResponse({ rate: userSettings.exchangeRate || 1.0 });
                }

                if (request.method === 'POST') {
                    if (!user) return errorResponse('No autenticado', 401);
                    const body = await request.json();
                    const rate = parseFloat(body.rate);
                    if (isNaN(rate)) return errorResponse('Invalid rate', 400);

                    if (!settings[userId]) settings[userId] = {};
                    settings[userId].exchangeRate = rate;
                    await writeJson('settings', settings);
                    return jsonResponse({ success: true, rate });
                }
            }

            if (url.pathname === '/settings' && request.method === 'GET') {
                const settings = (await readJson('settings')) || {};
                const userId = user ? user.id : 'admin-1';
                return jsonResponse({ rate: settings[userId]?.exchangeRate || 1.0 });
            }

            if (url.pathname === '/settings/payment-methods') {
                let methods = (await readJson('payment_methods')) || [];
                const userId = user ? user.id : 'admin-1';

                if (request.method === 'GET') {
                    let userMethods = methods.filter(m => m.userId === userId);
                    return jsonResponse(userMethods);
                }

                if (request.method === 'POST') {
                    if (!user) return errorResponse('No autenticado', 401);
                    const body = await request.json();
                    if (!Array.isArray(body)) return errorResponse('Expected array', 400);

                    // Remove existing for this user
                    methods = methods.filter(m => m.userId !== userId);
                    // Add new ones (tagged with userId)
                    const newMethods = body.map(m => ({ ...m, userId }));
                    methods = [...methods, ...newMethods];

                    await writeJson('payment_methods', methods);
                    return jsonResponse({ success: true, count: newMethods.length });
                }
            }

            // --- Cash Control (DB Based) ---

            // GET /cash/current
            if (url.pathname === '/cash/current' && request.method === 'GET') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = await readJson('db') || {};

                if (!db.cash_shifts) db.cash_shifts = [];
                if (!db.cash_movements) db.cash_movements = [];

                const currentShift = db.cash_shifts.find(s => s.status === 'open');

                if (!currentShift) {
                    return jsonResponse(null);
                }

                const movements = db.cash_movements.filter(m => m.shiftId === currentShift.id);
                const sales = (db.sales || []).filter(s => {
                    const saleDate = new Date(s.timestamp);
                    const openDate = new Date(currentShift.openedAt);
                    return saleDate >= openDate;
                });

                // Calculate payment breakdown by method
                const paymentBreakdown = {};
                let cashSalesTotal = 0;
                let totalSalesAmount = 0;

                sales.forEach(sale => {
                    totalSalesAmount += sale.total || 0;
                    const paymentArray = sale.paymentDetails || sale.paymentMethods || [];

                    if (Array.isArray(paymentArray) && paymentArray.length > 0) {
                        paymentArray.forEach(pd => {
                            const method = pd.method || 'cash';
                            const amount = pd.currency === 'VES' ? (pd.amount / (sale.exchangeRate || 1)) : pd.amount;

                            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + amount;

                            if (['cash', 'cash_usd', 'cash_bs', 'cash_ves'].includes(method)) {
                                cashSalesTotal += amount;
                            }
                        });
                    } else {
                        // Legacy: assume cash
                        const method = sale.paymentMethod || 'cash';
                        paymentBreakdown[method] = (paymentBreakdown[method] || 0) + (sale.total || 0);
                        if (method === 'cash' || !sale.paymentMethod) {
                            cashSalesTotal += sale.total || 0;
                        }
                    }
                });

                const deposits = movements.filter(m => m.type === 'in');
                const withdrawals = movements.filter(m => m.type === 'out');
                const expenses = movements.filter(m => m.type === 'expense');

                const totalIn = deposits.reduce((sum, m) => sum + m.amount, 0);
                const totalOut = withdrawals.reduce((sum, m) => sum + m.amount, 0);
                const totalExpenses = expenses.reduce((sum, m) => sum + m.amount, 0);

                // Expected cash in USD
                const expectedCash = (currentShift.startingCash || 0) + cashSalesTotal + totalIn - totalOut - totalExpenses;

                return jsonResponse({
                    ...currentShift,
                    salesCount: sales.length,
                    totalSalesAmount,
                    avgTicket: sales.length > 0 ? totalSalesAmount / sales.length : 0,
                    cashSalesTotal,
                    paymentBreakdown,
                    totalIn,
                    totalOut,
                    totalExpenses,
                    expectedCash,
                    movements: movements.slice(-10) // Last 10 movements
                });
            }

            // POST /cash/open
            if (url.pathname === '/cash/open' && request.method === 'POST') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = await readJson('db') || {};
                if (!db.cash_shifts) db.cash_shifts = [];

                const openShift = db.cash_shifts.find(s => s.status === 'open');
                if (openShift) {
                    return errorResponse('Ya hay una caja abierta', 400);
                }

                const body = await request.json();
                const newShift = {
                    id: Date.now().toString(),
                    openedAt: new Date().toISOString(),
                    closedAt: null,
                    startingCash: parseFloat(body.amount) || 0,
                    expectedCash: 0,
                    actualCash: 0,
                    status: 'open',
                    userId: user.id
                };

                db.cash_shifts.push(newShift);
                const success = await writeJson('db', db);
                if (!success) return errorResponse('Database Write Failed', 500);
                return jsonResponse(newShift, 201);
            }

            // POST /cash/close
            if (url.pathname === '/cash/close' && request.method === 'POST') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = await readJson('db') || {};

                const currentShift = (db.cash_shifts || []).find(s => s.status === 'open');
                if (!currentShift) {
                    return errorResponse('No hay caja abierta para cerrar', 400);
                }

                const body = await request.json();
                const actualCash = parseFloat(body.actualCash) || 0;

                const movements = (db.cash_movements || []).filter(m => m.shiftId === currentShift.id);
                const sales = (db.sales || []).filter(s => {
                    const saleDate = new Date(s.timestamp);
                    const openDate = new Date(currentShift.openedAt);
                    return saleDate >= openDate;
                });

                // Calculate payment breakdown
                const paymentBreakdown = {};
                let cashSalesTotal = 0;
                let totalSalesAmount = 0;

                sales.forEach(sale => {
                    totalSalesAmount += sale.total || 0;
                    const paymentArray = sale.paymentDetails || sale.paymentMethods || [];

                    if (Array.isArray(paymentArray) && paymentArray.length > 0) {
                        paymentArray.forEach(pd => {
                            const method = pd.method || 'cash';
                            const amount = pd.currency === 'VES' ? (pd.amount / (sale.exchangeRate || 1)) : pd.amount;
                            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + amount;
                            if (['cash', 'cash_usd', 'cash_bs', 'cash_ves'].includes(method)) {
                                cashSalesTotal += amount;
                            }
                        });
                    } else {
                        const method = sale.paymentMethod || 'cash';
                        paymentBreakdown[method] = (paymentBreakdown[method] || 0) + (sale.total || 0);
                        if (method === 'cash') cashSalesTotal += sale.total || 0;
                    }
                });

                const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
                const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);
                const totalExpenses = movements.filter(m => m.type === 'expense').reduce((sum, m) => sum + m.amount, 0);

                const expectedCash = (currentShift.startingCash || 0) + cashSalesTotal + totalIn - totalOut - totalExpenses;

                currentShift.closedAt = new Date().toISOString();
                currentShift.status = 'closed';
                currentShift.actualCash = actualCash;
                currentShift.expectedCash = expectedCash;
                currentShift.difference = actualCash - expectedCash;
                currentShift.salesCount = sales.length;
                currentShift.totalSalesAmount = totalSalesAmount;
                currentShift.cashSalesTotal = cashSalesTotal;
                currentShift.paymentBreakdown = paymentBreakdown;
                currentShift.totalIn = totalIn;
                currentShift.totalOut = totalOut;
                currentShift.totalExpenses = totalExpenses;

                const success = await writeJson('db', db);
                if (!success) return errorResponse('Database Write Failed', 500);
                return jsonResponse(currentShift);
            }

            // POST /cash/movement
            if (url.pathname === '/cash/movement' && request.method === 'POST') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = await readJson('db') || {};
                if (!db.cash_movements) db.cash_movements = [];

                const currentShift = (db.cash_shifts || []).find(s => s.status === 'open');
                if (!currentShift) {
                    return errorResponse('Debe abrir la caja primero', 400);
                }

                const body = await request.json();
                const newMovement = {
                    id: Date.now().toString(),
                    shiftId: currentShift.id,
                    type: body.type,
                    amount: parseFloat(body.amount),
                    reason: body.reason,
                    timestamp: new Date().toISOString()
                };

                db.cash_movements.push(newMovement);
                const success = await writeJson('db', db);
                if (!success) return errorResponse('Database Write Failed', 500);
                return jsonResponse(newMovement, 201);
            }

            // GET /cash/x-report (Partial report without closing)
            if (url.pathname === '/cash/x-report' && request.method === 'GET') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = await readJson('db') || {};

                const currentShift = (db.cash_shifts || []).find(s => s.status === 'open');
                if (!currentShift) {
                    return errorResponse('No hay caja abierta', 400);
                }

                const movements = (db.cash_movements || []).filter(m => m.shiftId === currentShift.id);
                const sales = (db.sales || []).filter(s => {
                    const saleDate = new Date(s.timestamp);
                    const openDate = new Date(currentShift.openedAt);
                    return saleDate >= openDate;
                });

                // Calculate payment breakdown
                const paymentBreakdown = {};
                let cashSalesTotal = 0;
                let totalSalesAmount = 0;

                sales.forEach(sale => {
                    totalSalesAmount += sale.total || 0;
                    const paymentArray = sale.paymentDetails || sale.paymentMethods || [];

                    if (Array.isArray(paymentArray) && paymentArray.length > 0) {
                        paymentArray.forEach(pd => {
                            const method = pd.method || 'cash';
                            const amount = pd.currency === 'VES' ? (pd.amount / (sale.exchangeRate || 1)) : pd.amount;
                            paymentBreakdown[method] = (paymentBreakdown[method] || 0) + amount;
                            if (['cash', 'cash_usd', 'cash_bs', 'cash_ves'].includes(method)) {
                                cashSalesTotal += amount;
                            }
                        });
                    } else {
                        const method = sale.paymentMethod || 'cash';
                        paymentBreakdown[method] = (paymentBreakdown[method] || 0) + (sale.total || 0);
                        if (method === 'cash') cashSalesTotal += sale.total || 0;
                    }
                });

                const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
                const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);
                const totalExpenses = movements.filter(m => m.type === 'expense').reduce((sum, m) => sum + m.amount, 0);
                const expectedCash = (currentShift.startingCash || 0) + cashSalesTotal + totalIn - totalOut - totalExpenses;

                return jsonResponse({
                    type: 'X-REPORT',
                    timestamp: new Date().toISOString(),
                    shift: currentShift,
                    salesCount: sales.length,
                    totalSalesAmount,
                    avgTicket: sales.length > 0 ? totalSalesAmount / sales.length : 0,
                    paymentBreakdown,
                    cashSalesTotal,
                    deposits: totalIn,
                    withdrawals: totalOut,
                    expenses: totalExpenses,
                    expectedCash,
                    movements
                });
            }

            // GET /cash/history
            if (url.pathname === '/cash/history' && request.method === 'GET') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = await readJson('db') || {};

                const shifts = (db.cash_shifts || [])
                    .filter(s => s.status === 'closed')
                    .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
                    .slice(0, 30); // Last 30 closed shifts

                return jsonResponse(shifts);
            }

            // POST /sales/:id/email
            if (url.pathname.match(/^\/sales\/[^/]+\/email$/) && request.method === 'POST') {
                return jsonResponse({ success: true, message: 'Email queued' });
            }

            // --- Customers ---
            if (url.pathname === '/customers') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = (await readJson('db')) || {};

                const u = db.users?.find(u => u.id === user.id);
                const tenantId = u?.tenantId || 'admin-1';
                const customers = (db.customers || []).filter(c => c.tenantId === tenantId || (!c.tenantId && tenantId === 'admin-1'));

                return jsonResponse(customers);
            }

            // --- Sales ---
            if (url.pathname === '/sales') {
                if (!user) return errorResponse('No autenticado', 401);

                if (request.method === 'GET') {
                    const db = (await readJson('db')) || {};
                    const u = db.users?.find(u => u.id === user.id);
                    const tenantId = u?.tenantId || 'admin-1';
                    const sales = (db.sales || []).filter(s => s.tenantId === tenantId || (!s.tenantId && tenantId === 'admin-1'));
                    return jsonResponse(sales);
                }

                if (request.method === 'POST') {
                    const db = (await readJson('db')) || { sales: [] };
                    if (!db.sales) db.sales = [];

                    const saleData = await request.json();

                    const u = db.users?.find(u => u.id === user.id);
                    const tenantId = u?.tenantId || 'admin-1';

                    const newSale = {
                        id: Date.now().toString(),
                        ...saleData,
                        date: new Date().toISOString(),
                        tenantId: tenantId,
                        userId: user.id
                    };

                    db.sales.push(newSale);
                    await writeJson('db', db);

                    return jsonResponse(newSale, 201);
                }
            }

            // --- Users ---
            if (url.pathname === '/users' && request.method === 'GET') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = (await readJson('db')) || {};

                // Return users excluding passwords
                const safeUsers = (db.users || []).map(u => {
                    const { password, ...rest } = u;
                    return rest;
                });
                return jsonResponse(safeUsers);
            }

            if (url.pathname === '/users' && request.method === 'POST') {
                if (!user) return errorResponse('No autenticado', 401);
                const body = await request.json();

                if (!body.email || !body.password) return errorResponse('Email and password required', 400);

                const db = (await readJson('db')) || { users: [] };
                if (!db.users) db.users = [];

                if (db.users.find(u => u.email === body.email)) {
                    return errorResponse('El usuario ya existe', 400);
                }

                // Data Isolation Logic
                const creator = db.users.find(u => u.id === user.id);
                const creatorTenantId = creator?.tenantId || 'admin-1';

                const newId = Date.now().toString();
                const newTenantId = body.dataScope === 'isolated' ? newId : creatorTenantId;

                const newUser = {
                    id: newId,
                    email: body.email,
                    password: body.password,
                    role: body.role || 'user',
                    businessInfo: body.businessInfo || {},
                    status: 'active',
                    tenantId: newTenantId,
                    ...body
                };

                db.users.push(newUser);
                await writeJson('db', db);

                const { password, ...safeUser } = newUser;
                return jsonResponse(safeUser, 201);
            }

            if (url.pathname.startsWith('/users/') && request.method === 'PUT') {
                if (!user) return errorResponse('No autenticado', 401);
                const id = url.pathname.split('/').pop();
                const body = await request.json();

                const db = (await readJson('db')) || { users: [] };
                const userIndex = db.users.findIndex(u => u.id === id);

                if (userIndex === -1) return errorResponse('Usuario no encontrado', 404);

                if (body.dataScope) {
                    if (body.dataScope === 'isolated') {
                        db.users[userIndex].tenantId = id;
                    } else if (body.dataScope === 'shared') {
                        const adminUser = db.users.find(u => u.id === user.id);
                        db.users[userIndex].tenantId = adminUser?.tenantId || 'admin-1';
                    }
                }

                db.users[userIndex] = { ...db.users[userIndex], ...body };
                await writeJson('db', db);
                const { password, ...safeUser } = db.users[userIndex];
                return jsonResponse(safeUser);
            }

            if (url.pathname.startsWith('/users/') && request.method === 'DELETE') {
                if (!user) return errorResponse('No autenticado', 401);
                const id = url.pathname.split('/').pop();

                const db = (await readJson('db')) || { users: [] };
                const initialLength = db.users.length;
                db.users = db.users.filter(u => u.id !== id);

                if (db.users.length === initialLength) return errorResponse('Usuario no encontrado', 404);

                await writeJson('db', db);
                return jsonResponse({ success: true });
            }

            // GET /reports/daily
            if (url.pathname === '/reports/daily' && request.method === 'GET') {
                if (!user) return errorResponse('No autenticado', 401);
                const db = await readJson('db') || {};
                const urlObj = new URL(request.url);
                const dateStr = urlObj.searchParams.get('date') || new Date().toISOString().split('T')[0];

                const startOfDay = new Date(dateStr);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(dateStr);
                endOfDay.setHours(23, 59, 59, 999);

                const dailySales = (db.sales || []).filter(s => {
                    const d = new Date(s.timestamp);
                    return d >= startOfDay && d <= endOfDay;
                });

                const totalRevenue = dailySales.reduce((sum, s) => sum + (s.total || 0), 0);

                return jsonResponse({
                    date: dateStr,
                    totalRevenue,
                    transactionCount: dailySales.length
                });
            }

            // ========== BACKUP ENDPOINT ==========
            if (url.pathname === '/backup') {
                const user = verifyToken(request);
                if (!user) return errorResponse('Unauthorized', 401);

                if (request.method === 'GET') {
                    // Get full database backup
                    const db = (await readJson('db')) || { products: [], sales: [], users: [], customers: [] };
                    const settings = (await readJson('settings')) || {};

                    const backup = {
                        timestamp: new Date().toISOString(),
                        version: '1.0',
                        data: { db, settings }
                    };

                    return new Response(JSON.stringify(backup, null, 2), {
                        status: 200,
                        headers: {
                            ...corsHeaders,
                            'Content-Type': 'application/json',
                            'Content-Disposition': `attachment; filename="pos-backup-${new Date().toISOString().slice(0, 10)}.json"`
                        }
                    });
                }

                if (request.method === 'POST') {
                    // Restore from backup
                    const body = await request.json();
                    if (!body.data || !body.data.db) {
                        return errorResponse('Invalid backup format', 400);
                    }

                    await writeJson('db', body.data.db);
                    if (body.data.settings) {
                        await writeJson('settings', body.data.settings);
                    }

                    return jsonResponse({ success: true, message: 'Backup restored successfully' });
                }
            }

            // ========== BACKUP HISTORY ==========
            if (url.pathname === '/backup/history') {
                const user = verifyToken(request);
                if (!user) return errorResponse('Unauthorized', 401);

                const backups = (await readJson('backups')) || [];
                return jsonResponse(backups.slice(-10)); // Last 10 backups
            }

            return errorResponse('Not Found', 404);

        } catch (e) {
            return errorResponse(`Server Error: ${e.message}`, 500);
        }
    },

    // ========== SCHEDULED BACKUP (Cron Trigger) ==========
    async scheduled(event, env, ctx) {
        console.log('Scheduled backup triggered at:', new Date().toISOString());

        const readJson = async (key) => {
            try {
                const stmt = env.DB.prepare('SELECT value FROM kv_store WHERE key = ?').bind(key);
                const result = await stmt.first();
                return result ? JSON.parse(result.value) : null;
            } catch (e) {
                console.error(`Error reading ${key}:`, e);
                return null;
            }
        };

        const writeJson = async (key, data) => {
            try {
                const value = JSON.stringify(data);
                const stmt = env.DB.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').bind(key, value);
                await stmt.run();
                return true;
            } catch (e) {
                console.error(`Error writing ${key}:`, e);
                return false;
            }
        };

        try {
            // Read current data
            const db = (await readJson('db')) || { products: [], sales: [], users: [], customers: [] };
            const settings = (await readJson('settings')) || {};

            // Create backup entry
            const backup = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                productsCount: db.products?.length || 0,
                salesCount: db.sales?.length || 0,
                customersCount: db.customers?.length || 0,
                data: { db, settings }
            };

            // Read existing backups
            let backups = (await readJson('backups')) || [];

            // Keep only last 7 backups (one week of daily backups)
            backups.push(backup);
            if (backups.length > 7) {
                backups = backups.slice(-7);
            }

            // Save backups
            await writeJson('backups', backups);

            console.log('Backup completed successfully:', backup.id);
        } catch (e) {
            console.error('Scheduled backup failed:', e);
        }
    }
};
