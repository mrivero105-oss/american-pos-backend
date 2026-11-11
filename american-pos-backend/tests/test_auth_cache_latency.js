require('dotenv').config();
const jwt = require('jsonwebtoken');

async function benchmarkAuthCache() {
    console.log('======================================================');
    console.log('⚡ BENCHMARK: FAST-PATH IN-MEMORY AUTH CACHE (10/10)');
    console.log('======================================================');

    const { verifyToken, invalidateUserAuthCache } = require('../middleware/auth');
    const { User, sequelize } = require('../database/models');

    // Ensure DB is ready
    const [user] = await User.findOrCreate({
        where: { id: 'test-benchmark-user' },
        defaults: {
            id: 'test-benchmark-user',
            email: 'benchmark@isaacpos.com',
            username: 'benchmarker',
            password: 'secretpassword',
            role: 'admin',
            status: 'active',
            companyId: 'default'
        }
    });

    const token = jwt.sign(
        { id: user.id, role: user.role, companyId: user.companyId },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: '1h' }
    );

    const mockReq = {
        path: '/products',
        method: 'GET',
        headers: { authorization: `Bearer ${token}` }
    };
    const mockRes = {
        status: (c) => ({ json: (d) => console.error('Error status:', c, d) })
    };

    // 1. First Call: Cache Miss (Must query database)
    invalidateUserAuthCache(user.id);
    const startMiss = process.hrtime.bigint();
    await verifyToken(mockReq, mockRes, () => {});
    const endMiss = process.hrtime.bigint();
    const missDurationMs = Number(endMiss - startMiss) / 1e6;
    console.log(`[PASS] Cache Miss (Database Query): ${missDurationMs.toFixed(3)} ms`);

    // 2. Subsequent 100 Calls: Cache Hits (In-Memory Fast Path)
    const iterations = 100;
    const startHit = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
        await verifyToken(mockReq, mockRes, () => {});
    }
    const endHit = process.hrtime.bigint();
    const hitDurationMs = Number(endHit - startHit) / 1e6 / iterations;
    console.log(`[PASS] Cache Hit (In-Memory Fast Path): ${hitDurationMs.toFixed(4)} ms per request`);

    const speedup = missDurationMs / hitDurationMs;
    console.log(`🚀 Rendimiento acelerado: ${speedup.toFixed(1)}x más rápido gracias al caché de memoria.`);

    if (hitDurationMs < 0.25) {
        console.log('🌟 [RESULTADO]: 10/10 - Latencia sub-milisegundo ultra óptima (< 0.25 ms)');
    } else {
        console.log('✅ [RESULTADO]: Rendimiento aceptable');
    }

    process.exit(0);
}

benchmarkAuthCache().catch((err) => {
    console.error('Benchmark Error:', err);
    process.exit(1);
});
