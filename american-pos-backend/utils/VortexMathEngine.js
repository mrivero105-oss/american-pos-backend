/**
 * VORTEX MATH ENGINE v3.0 (Enterprise Financial Grade)
 * Motor centralizado de cálculo financiero y aritmético sin punto flotante IEEE 754.
 * Implementa el Patrón Fowler (aritmética en centavos y BigInt exacto a 10^8).
 * PROHIBIDO EL USO DE OPERADORES NATIVOS (+, -, *, /) SOBRE DINERO EN RAW FLOAT.
 */

const FACTOR = 100000000n; // 10^8 factor de precisión interna

const parseToStringExact = (val) => {
    if (val === null || val === undefined) return '0';
    if (typeof val === 'bigint') return val.toString();
    let s;
    if (typeof val === 'number') {
        if (isNaN(val) || !isFinite(val)) return '0';
        s = val.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 8 });
    } else {
        s = String(val).trim();
    }
    if (s === '') return '0';
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(/,/g, '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(/,/g, '.');
    }
    return s;
};

const parseNumericInput = (val) => {
    const s = parseToStringExact(val);
    const n = Number(s);
    return isNaN(n) ? 0 : n;
};

/**
 * Convierte un número o string a BigInt interno con 8 decimales exactos SIN pérdida por flotantes IEEE 754.
 */
const toBigIntExact = (val) => {
    if (val === null || val === undefined) return 0n;
    if (typeof val === 'bigint') return val * FACTOR;
    if (typeof val === 'number' && !Number.isFinite(val)) return 0n;
    let s = parseToStringExact(val).trim();
    if (!s) return 0n;
    // Expandir notación científica (ej. 1e-7, 2.5e+4) de forma segura sin SyntaxError en BigInt
    if (/[eE]/.test(s)) {
        const num = Number(s);
        if (!Number.isFinite(num)) return 0n;
        s = num.toFixed(10);
    }
    const sign = s.startsWith('-') ? -1n : 1n;
    if (s.startsWith('-') || s.startsWith('+')) s = s.slice(1);
    if (!/^\d*(?:\.\d*)?$/.test(s) || s === '' || s === '.') {
        return 0n;
    }
    const parts = s.split('.');
    const integerPart = parts[0] || '0';
    const fracRaw = parts[1] || '';
    const fracPart = fracRaw.padEnd(8, '0').slice(0, 8);
    let rawBig = BigInt(integerPart + fracPart);
    if (fracRaw.length > 8) {
        const nextDigit = parseInt(fracRaw[8], 10);
        if (nextDigit >= 5) rawBig += 1n;
    }
    return sign * rawBig;
};

/**
 * Convierte un BigInt interno a Number con precisión exacta.
 */
const fromBigIntExact = (valBig) => {
    const sign = valBig < 0n ? "-" : "";
    const absBig = valBig < 0n ? -valBig : valBig;
    const integerPart = (absBig / FACTOR).toString();
    const fracPart = (absBig % FACTOR).toString().padStart(8, '0');
    const cleanFrac = fracPart.replace(/0+$/, '');
    const numStr = cleanFrac ? `${sign}${integerPart}.${cleanFrac}` : `${sign}${integerPart}`;
    return Number(numStr);
};

const VortexMathEngine = {
    parseNumericInput,
    toBigInt: toBigIntExact,
    fromBigInt: fromBigIntExact,

    /**
     * Patrón Fowler: Convierte importe financiero a centavos enteros (ej. 10.50 -> 1050)
     */
    toCents: (val) => {
        const big = toBigIntExact(val);
        const rem = big % 1000000n;
        let cents = big / 1000000n;
        if (rem >= 500000n || rem <= -500000n) {
            cents += (big >= 0n ? 1n : -1n);
        }
        return Number(cents);
    },

    /**
     * Patrón Fowler: Convierte centavos enteros a importe decimal (ej. 1050 -> 10.50)
     */
    fromCents: (cents) => {
        const c = Number(cents) || 0;
        return Math.round(c) / 100;
    },

    /**
     * Redondeo financiero bancario estricto (por defecto a 2 decimales).
     */
    round: (value, decimals = 2) => {
        const big = toBigIntExact(value);
        const shift = 8 - decimals;
        if (shift <= 0) return fromBigIntExact(big);
        const divisor = BigInt(Math.pow(10, shift));
        const rem = big % divisor;
        let roundedBig = (big / divisor) * divisor;
        const half = divisor / 2n;
        if (rem >= half || rem <= -half) {
            roundedBig += (big >= 0n ? divisor : -divisor);
        }
        return fromBigIntExact(roundedBig);
    },

    /**
     * Suma exacta de dos o más valores. Acepta arreglo [a, b, ...] o (a, b).
     */
    add: (a, b) => {
        let values;
        if (Array.isArray(a)) {
            values = a;
        } else if (b !== undefined) {
            values = [a, b];
        } else {
            return parseNumericInput(a);
        }
        const sumBig = values.reduce((acc, v) => acc + toBigIntExact(v), 0n);
        return fromBigIntExact(sumBig);
    },

    /**
     * Resta exacta de dos valores (a - b).
     */
    subtract: (a, b) => {
        return fromBigIntExact(toBigIntExact(a) - toBigIntExact(b));
    },

    /**
     * Multiplicación exacta de dos valores (a * b) con redondeo half-up en BigInt.
     */
    multiply: (a, b) => {
        const num = toBigIntExact(a) * toBigIntExact(b);
        const sign = num < 0n ? -1n : 1n;
        const absNum = num < 0n ? -num : num;
        const resultBig = sign * ((absNum + FACTOR / 2n) / FACTOR);
        return fromBigIntExact(resultBig);
    },

    /**
     * División exacta de dos valores (a / b) con redondeo half-up en BigInt.
     */
    divide: (a, b) => {
        const bBig = toBigIntExact(b);
        if (bBig === 0n) return 0;
        const num = toBigIntExact(a) * FACTOR;
        const sign = (num < 0n) !== (bBig < 0n) ? -1n : 1n;
        const absNum = num < 0n ? -num : num;
        const absDen = bBig < 0n ? -bBig : bBig;
        const resultBig = sign * ((absNum + absDen / 2n) / absDen);
        return fromBigIntExact(resultBig);
    },

    normalizeToUsd: (amount, rate) => VortexMathEngine.divide(amount, rate),
    toVes: (usdAmount, rate) => VortexMathEngine.multiply(usdAmount, rate),

    /**
     * Verificación de igualdad con tolerancia cero (diferencia menor a 0.0001)
     */
    isEqualExact: (a, b) => {
        const diff = Math.abs(VortexMathEngine.subtract(a, b));
        return diff < 0.0001;
    },

    /**
     * Normaliza un valor decimal de base de datos a número limpio exacto sin ruido IEEE 754
     */
    cleanDecimal: (val, defaultValue = null) => {
        if (val === null || val === undefined) return defaultValue;
        return fromBigIntExact(toBigIntExact(val));
    }
};

VortexMathEngine.safeSum = VortexMathEngine.add;
VortexMathEngine.mul = VortexMathEngine.multiply;
VortexMathEngine.sub = VortexMathEngine.subtract;
VortexMathEngine.div = VortexMathEngine.divide;
VortexMathEngine.toInt = (v) => Number(toBigIntExact(v));
VortexMathEngine.fromInt = (v) => fromBigIntExact(BigInt(v));

module.exports = VortexMathEngine;
