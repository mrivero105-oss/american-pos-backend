/**
 * PRECISION UTILITY v3.0 (Delegación al VortexMathEngine)
 * Mantiene compatibilidad total con código existente delegando al motor bancario central.
 */

import VortexMathEngine from './VortexMathEngine';

export default VortexMathEngine;
export const {
    parseNumericInput,
    toBigInt,
    fromBigInt,
    toCents,
    fromCents,
    round,
    add,
    safeSum,
    subtract,
    multiply,
    divide,
    normalizeToUsd,
    toVes,
    isEqualExact
} = VortexMathEngine;
