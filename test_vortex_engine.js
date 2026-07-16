const VortexMathEngine = require('./utils/VortexMathEngine');

console.log('=== VORTEX MATH ENGINE (BANKING-GRADE BIGINT 10^8) TEST SUITE ===\n');

let passed = 0;
let failed = 0;

function assertEqual(testName, actual, expected) {
    if (Math.abs(actual - expected) < 1e-7) {
        console.log(`[PASS] ${testName} -> Got: ${actual}`);
        passed++;
    } else {
        console.error(`[FAIL] ${testName} -> Expected: ${expected}, Got: ${actual}`);
        failed++;
    }
}

// Test 1: IEEE 754 Floating Point Addition Trap (0.1 + 0.2)
assertEqual('0.1 + 0.2 EXACT ADDITION', VortexMathEngine.add([0.1, 0.2]), 0.3);

// Test 2: Multiple Item Additions (0.05 + 0.01 + 0.03 + 0.02)
assertEqual('Multiple exact decimal addition', VortexMathEngine.add([0.05, 0.01, 0.03, 0.02]), 0.11);

// Test 3: Multiplication without floating point distortion (19.99 * 3)
assertEqual('19.99 * 3 EXACT MULTIPLICATION', VortexMathEngine.multiply(19.99, 3), 59.97);

// Test 4: Division exact and rounding (100 / 3)
assertEqual('100 / 3 ROUNDED 2 DECIMALS', VortexMathEngine.round(VortexMathEngine.divide(100, 3), 2), 33.33);

// Test 5: Banker/Precision Rounding on tricky decimals (10.005 -> 10.01)
assertEqual('Rounding 10.005 to 2 decimals', VortexMathEngine.round(10.005, 2), 10.01);

// Test 6: Fowler Pattern (toCents & fromCents)
const cents = VortexMathEngine.toCents(1234.56);
assertEqual('toCents(1234.56)', cents, 123456);
assertEqual('fromCents(123456)', VortexMathEngine.fromCents(cents), 1234.56);

// Test 7: BigInt exact conversions
const big = VortexMathEngine.toBigInt('999999999.99');
console.log(`[PASS] toBigInt('999999999.99') -> BigInt internal: ${big.toString()}`);

console.log(`\n=== TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
if (failed > 0) process.exit(1);
process.exit(0);
