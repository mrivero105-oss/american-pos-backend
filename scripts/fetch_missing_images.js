const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { Product } = require('../database/models');

const IMAGES_DIR = path.join(__dirname, '..', 'product_images');

// Provide reasonable limits so it doesn't run forever
const MAX_TO_PROCESS = 2000; // Set high to process everything remaining in one go

if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function downloadImage(url, filepath) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filepath, buffer);
}

(async () => {
    const fs = require('fs');
    const path = require('path');
    console.log('Starting automated image downloader via Sequelize...');

    const products = await Product.findAll();
    const productsToProcess = products.filter(p => {
        if (!p.imageUri || p.imageUri.trim() === '') return true;
        if (p.imageUri.length > 200) return false; // Is Base64

        // If it's a file path, check if it actually exists on disk
        const filename = path.basename(p.imageUri);
        const filepath = path.join(IMAGES_DIR, filename);
        if (!fs.existsSync(filepath)) {
            return true;
        }
        return false;
    }).slice(0, MAX_TO_PROCESS);

    console.log(`Found ${productsToProcess.length} products needing images (limited to ${MAX_TO_PROCESS} for this run).`);

    if (productsToProcess.length === 0) {
        console.log('No products to process.');
        process.exit(0);
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const product of productsToProcess) {
        processedCount++;
        const productName = product.name;
        console.log(`[${processedCount}/${productsToProcess.length}] Searching for: "${productName}"...`);

        try {
            // Add 'venezuela' or 'producto' to improve results context
            const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(productName + ' producto venenzuela')}&t=h_&iax=images&ia=images`;
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });

            try {
                await page.waitForSelector('img[src*="external-content.duckduckgo.com"]', { timeout: 5000 });
            } catch (e) {
                console.log(`  No results found for "${productName}".`);
                errorCount++;
                continue;
            }

            const imageUrl = await page.evaluate(() => {
                const img = document.querySelector('img[src*="external-content.duckduckgo.com"]');
                if (!img) return null;
                let src = img.dataset.src || img.src;
                if (src && src.startsWith('//')) src = 'https:' + src;
                return src;
            });

            if (!imageUrl) {
                console.log(`  No image URL found.`);
                errorCount++;
                continue;
            }

            let ext = 'jpg';
            if (imageUrl.includes('.png')) ext = 'png';
            if (imageUrl.includes('.webp')) ext = 'webp';

            const filename = `${sanitizeFilename(productName)}_${Date.now()}.${ext}`;
            const filepath = path.join(IMAGES_DIR, filename);

            try {
                await downloadImage(imageUrl, filepath);
                product.imageUri = `/product_images/${filename}`;
                await product.save();
                successCount++;
                console.log(`  Saved to: ${filename}`);
            } catch (downloadErr) {
                console.error(`  Download failed: ${downloadErr.message}`);
                errorCount++;
            }
        } catch (err) {
            console.error(`  Error processing "${productName}": ${err.message}`);
            errorCount++;
        }

        await sleep(2000);
    }

    await browser.close();
    console.log('-----------------------------------');
    console.log(`Finished! Processed: ${processedCount}, Success: ${successCount}, Errors: ${errorCount}`);
    process.exit(0);
})();
