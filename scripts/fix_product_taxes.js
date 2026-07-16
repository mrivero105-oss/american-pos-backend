const { Product } = require('../database/models');

const EXEMPT_KEYWORDS = [
    // Alimentos Básicos
    'arroz', 'harina', 'pasta', 'sal', 'azucar', 'café', 'cafe', 'leche', 'queso',
    'mantequilla', 'margarina', 'carne', 'pollo', 'atun', 'atún', 'sardina',
    'avena', 'aceite', 'mortadela', 'mayonesa', 'huevo', 'caraota', 'lenteja',
    'arveja', 'frijol', 'pan', 'maiz', 'maíz', 'papa', 'cebolla', 'tomate',

    // Farmacia / Salud
    'amoxicilina', 'acetaminofen', 'alcohol', 'algodon', 'medicina', 'pastilla',
    'tableta', 'jarabe', 'ampolla', 'apiret', 'desloratadina', 'azitromicina',
    'gervit', 'diclofenac', 'ibuprofeno', 'loratadina', 'vitamin', 'suero',

    // Útiles Escolares
    'cuaderno', 'lapiz', 'lápiz', 'creyon', 'creyón', 'borrador', 'sacapunta',
    'morral', 'pega blanca', 'tempera', 'tijera', 'regla', 'escuadra', 'block'
];

const TAXABLE_EXCEPTIONS = [
    'oliva', 'licor', 'cerveza', 'refresco', 'malta', 'snack', 'pepito', 'chupeta',
    'caramelo', 'chocolate', 'galleta', 'savoy', 'electronico', 'juguete'
];

async function updateTaxes() {
    console.log('Iniciando recategorización de IVA...');
    const products = await Product.findAll();
    let updatedExento = 0;
    let updatedGravable = 0;

    for (const product of products) {
        const name = product.name.toLowerCase();
        let newStatus = 'gravable';

        // Regla 1: Buscar palabras clave exentas
        const isExempt = EXEMPT_KEYWORDS.some(keyword => name.includes(keyword));

        // Regla 2: Verificar excepciones (cosas que tienen la palabra pero son gravables)
        const isException = TAXABLE_EXCEPTIONS.some(exc => name.includes(exc));

        if (isExempt && !isException) {
            newStatus = 'exento';
        }

        // Caso especial Farmacia
        if (product.category && product.category.toLowerCase().includes('farmacia')) {
            newStatus = 'exento';
        }

        if (product.taxStatus !== newStatus) {
            product.taxStatus = newStatus;
            await product.save();
            if (newStatus === 'exento') updatedExento++;
            else updatedGravable++;
        }
    }

    console.log(`Finalizado. Recategorizados como Exento: ${updatedExento}, Como Gravable: ${updatedGravable}`);
    process.exit(0);
}

updateTaxes().catch(err => {
    console.error(err);
    process.exit(1);
});
