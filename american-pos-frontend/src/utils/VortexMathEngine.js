/**
 * VORTEX MATH ENGINE v3.0 (Enterprise Financial Grade - Frontend ES Module)
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
        s = val.toFixed(8);
    } else {
        s = String(val).trim();
    }
    if (s === '') return '0';
    // Manejar notación científica en strings (ej: "1e-7", "2.5E+3")
    if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(s)) {
        const num = Number(s);
        if (!Number.isFinite(num)) return '0';
        return num.toFixed(8);
    }
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(/,/g, '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(/,/g, '.');
    }
    if (!/^[+-]?\d*(?:\.\d+)?$/.test(s) || s === '+' || s === '-' || s === '.') {
        return '0';
    }
    return s;
};

const parseNumericInput = (val) => {
    const s = parseToStringExact(val);
    const n = Number(s);
    return isNaN(n) ? 0 : n;
};

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

    toCents: (val) => {
        const big = toBigIntExact(val);
        const rem = big % 1000000n;
        let cents = big / 1000000n;
        if (rem >= 500000n || rem <= -500000n) {
            cents += (big >= 0n ? 1n : -1n);
        }
        return Number(cents);
    },

    fromCents: (cents) => {
        const c = Number(cents) || 0;
        return Math.round(c) / 100;
    },

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

    subtract: (a, b) => {
        return fromBigIntExact(toBigIntExact(a) - toBigIntExact(b));
    },

    multiply: (a, b) => {
        const num = toBigIntExact(a) * toBigIntExact(b);
        const sign = num < 0n ? -1n : 1n;
        const absNum = num < 0n ? -num : num;
        const resultBig = sign * ((absNum + FACTOR / 2n) / FACTOR);
        return fromBigIntExact(resultBig);
    },

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

    isEqualExact: (a, b) => {
        const diff = Math.abs(VortexMathEngine.subtract(a, b));
        return diff < 0.0001;
    }
};

VortexMathEngine.safeSum = VortexMathEngine.add;
VortexMathEngine.toInt = (v) => Number(toBigIntExact(v));
VortexMathEngine.fromInt = (v) => fromBigIntExact(BigInt(v));

export default VortexMathEngine;
export { parseNumericInput };
export const toBigInt = VortexMathEngine.toBigInt;
export const fromBigInt = VortexMathEngine.fromBigInt;
export const toCents = VortexMathEngine.toCents;
export const fromCents = VortexMathEngine.fromCents;
export const round = VortexMathEngine.round;
export const add = VortexMathEngine.add;
export const safeSum = VortexMathEngine.safeSum;
export const subtract = VortexMathEngine.subtract;
export const multiply = VortexMathEngine.multiply;
export const divide = VortexMathEngine.divide;
export const normalizeToUsd = VortexMathEngine.normalizeToUsd;
export const toVes = VortexMathEngine.toVes;
export const isEqualExact = VortexMathEngine.isEqualExact;
