
// --- RUTAS DE CONTROL DE CAJA ---

// Obtener turno actual (abierto)
app.get('/cash/current', (req, res) => {
    const db = readJson(DB_FILE);
    // Ensure arrays exist
    if (!db.cash_shifts) db.cash_shifts = [];
    if (!db.cash_movements) db.cash_movements = [];

    const currentShift = db.cash_shifts.find(s => s.status === 'open');

    if (!currentShift) {
        return res.json(null);
    }

    // Calculate totals for current shift
    const movements = db.cash_movements.filter(m => m.shiftId === currentShift.id);
    const sales = db.sales.filter(s => {
        const saleDate = new Date(s.timestamp);
        const openDate = new Date(currentShift.openedAt);
        return saleDate >= openDate; // Simple check, ideally check if before closedAt (which is null here)
    });

    const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
    const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
    const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

    const expectedCash = currentShift.startingCash + totalSales + totalIn - totalOut;

    res.json({
        ...currentShift,
        totalSales,
        totalIn,
        totalOut,
        expectedCash
    });
});

// Abrir caja
app.post('/cash/open', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.cash_shifts) db.cash_shifts = [];

    // Check if already open
    const openShift = db.cash_shifts.find(s => s.status === 'open');
    if (openShift) {
        return res.status(400).json({ message: 'Ya hay una caja abierta' });
    }

    const newShift = {
        id: Date.now().toString(),
        openedAt: new Date().toISOString(),
        closedAt: null,
        startingCash: parseFloat(req.body.amount) || 0,
        expectedCash: 0, // Will be calculated on close
        actualCash: 0,
        status: 'open',
        userId: req.body.userId || 'admin'
    };

    db.cash_shifts.push(newShift);
    writeJson(DB_FILE, db);
    res.status(201).json(newShift);
});

// Cerrar caja
app.post('/cash/close', (req, res) => {
    const db = readJson(DB_FILE);
    const currentShift = db.cash_shifts.find(s => s.status === 'open');

    if (!currentShift) {
        return res.status(400).json({ message: 'No hay caja abierta para cerrar' });
    }

    const actualCash = parseFloat(req.body.actualCash) || 0;

    // Calculate expected
    const movements = (db.cash_movements || []).filter(m => m.shiftId === currentShift.id);
    const sales = db.sales.filter(s => {
        const saleDate = new Date(s.timestamp);
        const openDate = new Date(currentShift.openedAt);
        return saleDate >= openDate;
    });

    // Filter sales by cash payment method if possible, but for now assume all sales affect cash or logic handles it
    // Ideally we filter by paymentMethod === 'cash' or 'combined' parts.
    // For simplicity in this JSON DB version, we'll sum total sales. 
    // In a real app, we'd sum only CASH payments.

    // Let's try to be smarter:
    let cashSalesTotal = 0;
    sales.forEach(sale => {
        if (sale.paymentDetails) {
            sale.paymentDetails.forEach(pd => {
                if (pd.method === 'cash' || pd.method === 'cash_usd' || pd.method === 'cash_bs') {
                    // Convert to base currency (USD)
                    const amount = pd.currency === 'VES' ? (pd.amount / (sale.exchangeRate || 1)) : pd.amount;
                    cashSalesTotal += amount;
                }
            });
        } else {
            // Legacy or simple sale
            if (sale.paymentMethod === 'cash') {
                cashSalesTotal += sale.total;
            }
        }
    });

    const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
    const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

    const expectedCash = currentShift.startingCash + cashSalesTotal + totalIn - totalOut;

    currentShift.closedAt = new Date().toISOString();
    currentShift.status = 'closed';
    currentShift.actualCash = actualCash;
    currentShift.expectedCash = expectedCash;
    currentShift.difference = actualCash - expectedCash;

    writeJson(DB_FILE, db);
    res.json(currentShift);
});

// Registrar movimiento
app.post('/cash/movement', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.cash_movements) db.cash_movements = [];

    const currentShift = (db.cash_shifts || []).find(s => s.status === 'open');
    if (!currentShift) {
        return res.status(400).json({ message: 'Debe abrir la caja primero' });
    }

    const newMovement = {
        id: Date.now().toString(),
        shiftId: currentShift.id,
        type: req.body.type, // 'in' or 'out'
        amount: parseFloat(req.body.amount),
        reason: req.body.reason,
        timestamp: new Date().toISOString()
    };

    db.cash_movements.push(newMovement);
    writeJson(DB_FILE, db);
    res.status(201).json(newMovement);
});

// --- REPORTES ---
app.get('/reports/daily', (req, res) => {
    const db = readJson(DB_FILE);
    const dateStr = req.query.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const dailySales = db.sales.filter(s => {
        const d = new Date(s.timestamp);
        return d >= startOfDay && d <= endOfDay;
    });

    // Aggregate by category
    const byCategory = {};
    dailySales.forEach(s => {
        s.items.forEach(item => {
            const cat = item.category || 'Otros'; // Need to join with products if category not in item
            // In this simple DB, item might not have category. We'd need to look it up.
            // For speed, let's assume item has it or we skip it.
            // Actually, let's look it up from products array
            const product = db.products.find(p => p.id === item.id || p.id === item.productId);
            const category = product ? (product.category || 'Otros') : 'Otros';

            if (!byCategory[category]) byCategory[category] = 0;
            byCategory[category] += (item.price * item.quantity);
        });
    });

    // Aggregate by Payment Method
    const byPaymentMethod = {};
    dailySales.forEach(s => {
        if (s.paymentDetails) {
            s.paymentDetails.forEach(pd => {
                const method = pd.method;
                // Normalize amount to USD
                const amount = pd.currency === 'VES' ? (pd.amount / (s.exchangeRate || 1)) : pd.amount;
                if (!byPaymentMethod[method]) byPaymentMethod[method] = 0;
                byPaymentMethod[method] += amount;
            });
        } else {
            const method = s.paymentMethod || 'cash';
            if (!byPaymentMethod[method]) byPaymentMethod[method] = 0;
            byPaymentMethod[method] += s.total;
        }
    });

    res.json({
        date: dateStr,
        totalRevenue: dailySales.reduce((sum, s) => sum + s.total, 0),
        transactionCount: dailySales.length,
        byCategory,
        byPaymentMethod
    });
});
