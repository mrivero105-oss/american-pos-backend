const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');
const IMAGES_DIR = path.join(__dirname, 'public', 'product_images');
const DB_BACKUP_PATH = path.join(__dirname, 'db.json.bak');

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    console.log(`Created directory: ${IMAGES_DIR}`);
}

// Read DB
console.log(`Reading ${DB_PATH}...`);
const dbRaw = fs.readFileSync(DB_PATH, 'utf8');
const db = JSON.parse(dbRaw);

// Backup DB
console.log(`Backing up db.json to ${DB_BACKUP_PATH}...`);
fs.writeFileSync(DB_BACKUP_PATH, dbRaw);

const products = db.products;
let updatedCount = 0;
let errorCount = 0;
let skippedCount = 0;

// Helper to sanitize filename
function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Track used filenames to handle duplicates
const usedFilenames = new Set();

console.log(`Processing ${products.length} products...`);

products.forEach((product, index) => {
    if (!product.imageUri || !product.imageUri.startsWith('data:image')) {
        skippedCount++;
        return;
    }

    try {
        // Extract Base64 data
        const matches = product.imageUri.match(/^data:image\/([a-zA-Z]*);base64,+(.+)$/);

        if (!matches || matches.length !== 3) {
            console.warn(`Invalid base64 format for product: ${product.name} (ID: ${product.id})`);
            skippedCount++;
            return;
        }

        const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

        // Generate filename
        let baseName = sanitizeFilename(product.name || 'product_' + product.id);
        let fileName = `${baseName}.${extension}`;
        let counter = 1;

        while (usedFilenames.has(fileName)) {
            fileName = `${baseName}_${counter}.${extension}`;
            counter++;
        }

        usedFilenames.add(fileName);

        // Save image file
        const filePath = path.join(IMAGES_DIR, fileName);
        fs.writeFileSync(filePath, buffer);

        // Update product in DB
        // Use relative path for web access
        product.imageUri = `/product_images/${fileName}`;
        updatedCount++;

        if (index % 100 === 0) {
            process.stdout.write('.');
        }

    } catch (err) {
        console.error(`Error processing product ${product.name}:`, err.message);
        errorCount++;
    }
});

console.log('\nWriting updated db.json...');
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log('Done!');
console.log(`Updated: ${updatedCount}`);
console.log(`Skipped (no image or invalid): ${skippedCount}`);
console.log(`Errors: ${errorCount}`);
