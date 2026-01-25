const { Product } = require('./database/models');

async function fixGlobalEncoding() {
    try {
        console.log('--- STARTING GLOBAL ENCODING FIX ---');
        const products = await Product.findAll();
        let fixedCount = 0;

        const replacements = [
            { regex: /Ã¡/g, replacement: 'á' },
            { regex: /Ã©/g, replacement: 'é' },
            { regex: /Ã\xad/g, replacement: 'í' },
            { regex: /Ã³/g, replacement: 'ó' },
            { regex: /Ãº/g, replacement: 'ú' },
            { regex: /Ã±/g, replacement: 'ñ' },
            { regex: /Ã\x81/g, replacement: 'Á' },
            { regex: /Ã\x89/g, replacement: 'É' },
            { regex: /Ã\x8d/g, replacement: 'Í' },
            { regex: /Ã\x93/g, replacement: 'Ó' },
            { regex: /Ã\x9a/g, replacement: 'Ú' },
            { regex: /Ã\x91/g, replacement: 'Ñ' }
        ];

        for (const p of products) {
            let changed = false;
            let newName = p.name;
            let newCategory = p.category;

            replacements.forEach(({ regex, replacement }) => {
                if (newName && regex.test(newName)) {
                    newName = newName.replace(regex, replacement);
                    changed = true;
                }
                if (newCategory && regex.test(newCategory)) {
                    newCategory = newCategory.replace(regex, replacement);
                    changed = true;
                }
            });

            if (changed) {
                p.name = newName;
                p.category = newCategory;
                await p.save();
                fixedCount++;
                if (fixedCount % 100 === 0) console.log(`Fixed ${fixedCount} products...`);
            }
        }

        console.log(`\n--- FINISHED ---`);
        console.log(`Total products scanned: ${products.length}`);
        console.log(`Total products corrected: ${fixedCount}`);
        process.exit(0);
    } catch (e) {
        console.error('Fatal error:', e);
        process.exit(1);
    }
}

fixGlobalEncoding();
