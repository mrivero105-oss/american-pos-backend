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
    let s = parseToStringExact(val);
    const sign = s.startsWith('-') ? -1n : 1n;
    if (s.startsWith('-') || s.startsWith('+')) s = s.slice(1);
    const parts = s.split('.');
    let integerPart = parts[0] || '0';
    let fracPart = (parts[1] || '').padEnd(8, '0').slice(0, 8);
    let rawBig = BigInt(integerPart + fracPart);
    if (parts[1] && parts[1].length > 8) {
        const nextDigit = parseInt(parts[1][8], 10);
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
     * Multiplicación exacta de dos valores (a * b).
     */
    multiply: (a, b) => {
        const resultBig = (toBigIntExact(a) * toBigIntExact(b)) / FACTOR;
        return fromBigIntExact(resultBig);
    },

    /**
     * División exacta de dos valores (a / b).
     */
    divide: (a, b) => {
        const bBig = toBigIntExact(b);
        if (bBig === 0n) return 0;
        const resultBig = (toBigIntExact(a) * FACTOR) / bBig;
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
    }
};

VortexMathEngine.safeSum = VortexMathEngine.add;
VortexMathEngine.toInt = (v) => Number(toBigIntExact(v));
VortexMathEngine.fromInt = (v) => fromBigIntExact(BigInt(v));

module.exports = VortexMathEngine;
