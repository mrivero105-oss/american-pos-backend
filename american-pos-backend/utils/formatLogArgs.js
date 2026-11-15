'use strict';

/**
 * Serializa de forma segura un argumento para logging sin colapsar instancias
 * de Error a `{}` ni fallar ante referencias circulares o BigInt.
 * @param {*} arg
 * @param {{ pretty?: boolean }} [options]
 * @returns {string}
 */
function formatLogArg(arg, options = {}) {
    if (arg instanceof Error) {
        return arg.stack || `${arg.name || 'Error'}: ${arg.message || ''}`;
    }
    if (arg === null || typeof arg !== 'object') {
        return String(arg);
    }

    const seen = new WeakSet();
    try {
        const space = options.pretty ? 2 : undefined;
        return JSON.stringify(
            arg,
            (_key, value) => {
                if (value instanceof Error) {
                    return {
                        name: value.name,
                        message: value.message,
                        code: value.code,
                        stack: value.stack
                    };
                }
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                if (value !== null && typeof value === 'object') {
                    if (seen.has(value)) {
                        return '[Circular]';
                    }
                    seen.add(value);
                }
                return value;
            },
            space
        );
    } catch (_err) {
        return Object.prototype.toString.call(arg);
    }
}

/**
 * Une múltiples argumentos de console en un string legible.
 * @param {Array<*>} args
 * @param {{ pretty?: boolean }} [options]
 * @returns {string}
 */
function formatLogMessage(args, options = {}) {
    return args.map((arg) => formatLogArg(arg, options)).join(' ');
}

module.exports = {
    formatLogArg,
    formatLogMessage
};
