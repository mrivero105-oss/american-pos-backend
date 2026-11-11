const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../db.json');
const BACKUP_FILE = path.join(__dirname, '../db.json.bak_' + Date.now());

// Categorization Rules
// Order matters: More specific rules should come first if needed.
const RULES = [
    {
        category: 'Higiene Personal',
        keywords: ['abon', 'hampoo', 'condicionador', 'esodorante', 'rema', 'ental', 'entifrico', 'oallas s', 'oallas h', 'pañal', 'afeit', 'illette', 'cetona', 'protex', 'dove', 'pantene', 'head & shoulders', 'listerine', 'colgate', 'palmolive', 'speed stick', 'lady speed', 'seda dental']
    },
    {
        category: 'Limpieza',
        keywords: ['etergente', 'avaplatos', 'loro', 'esinfectante', 'impiador', 'ariel', 'ace', 'las llaves', 'vrujita', 'clorox', 'mistolin', 'suavitel']
    },
    {
        category: 'Farmacia',
        keywords: ['cetaminofen', 'buprofeno', 'lcohol', 'enda', 'astilla', 'atamel', 'migren', 'pedialyte', 'suero']
    },
    {
        category: 'Bebidas',
        keywords: ['efresco', 'ugo', 'gua', 'erveza', 'on', 'hisky', 'or-light', 'cocacola', 'pepsi', 'chinotto', 'maltin', 'gatorade', 'licor', 'caldas', 'cacique']
    },
    {
        category: 'Charcutería',
        keywords: ['amón', 'ueso', 'alchicha', 'ortadela', 'plumrose', 'oscar mayer']
    },
    {
        category: 'Golosinas',
        keywords: ['hocolate', 'alleta', 'epito', 'aramelo', 'chicle', 'pirulin', 'crios', 'savoy', 'oreo', 'waffer']
    },
    {
        category: 'Alimentos',
        keywords: ['ceite', 'rroz', 'asta', 'arina', 'alsa', 'inagre', 'ayonesa', 'etchup', 'azucar', 'al', 'afé', 'pan', 'maiz', 'trigo', 'fideos', 'mary', 'primor', 'mavesa', 'natulac']
    }
];

function categorizeProducts() {
    console.log('Reading DB...');
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    // Backup
    console.log(`Backing up to ${BACKUP_FILE}...`);
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2));

    let updatedCount = 0;

    data.products.forEach(product => {
        const nameLower = product.name.toLowerCase();
        let newCategory = null;

        // Find matching category
        for (const rule of RULES) {
            if (rule.keywords.some(k => nameLower.includes(k))) {
                newCategory = rule.category;
                break; // Stop at first match
            }
        }

        if (newCategory) {
            // Only update if current category is effectively empty, "General", "Sin Categoría", or seemingly wrong (like 'Víveres' for Shampoo)
            // Or just FORCE update to organize everything?
            // User said "Organiza todo". Let's update IF it matches a specific rule, essentially trusting our rules over existing data.
            // But let's be careful not to overwrite something correct with something vague.
            // Our rules are specific enough.

            if (product.category !== newCategory) {
                console.log(`Updating "${product.name}": "${product.category}" -> "${newCategory}"`);
                product.category = newCategory;
                updatedCount++;
            }
        }
    });

    console.log(`Updated ${updatedCount} products.`);

    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    console.log('Done.');
}

categorizeProducts();
