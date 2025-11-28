const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DB_PATH = path.join(__dirname, 'db.json');
const IMAGES_DIR = path.join(__dirname, 'public', 'product_images');
const DB_BACKUP_PATH = path.join(__dirname, 'db.json.bak_images');

// Configuration
const DELAY_MS = 3000; // 3 seconds delay between searches
const SAVE_INTERVAL = 10; // Save DB every 10 items
const MAX_RETRIES = 3;

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// Helper to sanitize filename (keep consistent with previous script)
function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Helper: Sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function downloadImage(url, filepath) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filepath, buffer);
}

(async () => {
    console.log('Starting automated image downloader...');

    // Load DB
    if (!fs.existsSync(DB_PATH)) {
        console.error('db.json not found!');
        process.exit(1);
    }
    const dbRaw = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(dbRaw);

    // Backup DB
    if (!fs.existsSync(DB_BACKUP_PATH)) {
        console.log(`Backing up db.json to ${DB_BACKUP_PATH}...`);
        fs.writeFileSync(DB_BACKUP_PATH, dbRaw);
    }

    // Filter products needing images
    // We target products that don't have a local image path yet
    const productsToProcess = db.products.filter(p => {
        return !p.imageUri || p.imageUri.trim() === '' || !p.imageUri.startsWith('/product_images/');
    });

    console.log(`Found ${productsToProcess.length} products needing images.`);

    if (productsToProcess.length === 0) {
        console.log('No products to process.');
        process.exit(0);
    }

    // Launch Browser
    const browser = await puppeteer.launch({
        headless: "new", // Use new headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Set user agent to look like a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const product of productsToProcess) {
        processedCount++;
        const productName = product.name;
        console.log(`[${processedCount}/${productsToProcess.length}] Searching for: "${productName}"...`);

        try {
            // Search DuckDuckGo Images
            const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(productName)}&t=h_&iax=images&ia=images`;

            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Wait for any image that looks like a result
            try {
                // New selector based on debug HTML: .SZ76bwIlqO8BBoqOLqYV img or just look for the external content images
                await page.waitForSelector('img[src*="external-content.duckduckgo.com"]', { timeout: 5000 });
            } catch (e) {
                console.log(`  No results found for "${productName}".`);
                errorCount++;
                continue;
            }

            // Get the first image URL
            const imageUrl = await page.evaluate(() => {
                // Try multiple potential selectors
                const img = document.querySelector('.SZ76bwIlqO8BBoqOLqYV img') ||
                    document.querySelector('.tile--img__img') ||
                    document.querySelector('img[src*="external-content.duckduckgo.com"]');

                if (!img) return null;

                let src = img.dataset.src || img.src;
                if (src && src.startsWith('//')) {
                    src = 'https:' + src;
                }
                return src;
            });

            if (!imageUrl) {
                console.log(`  No image URL found for "${productName}".`);
                errorCount++;
                continue;
            }

            // Determine extension (default to jpg if unknown)
            // Try to guess from URL, otherwise jpg
            let ext = 'jpg';
            if (imageUrl.includes('.png')) ext = 'png';
            if (imageUrl.includes('.webp')) ext = 'webp';
            if (imageUrl.includes('.jpeg')) ext = 'jpg';

            const filename = `${sanitizeFilename(productName)}.${ext}`;
            const filepath = path.join(IMAGES_DIR, filename);

            // Download
            // console.log(`  Downloading: ${imageUrl}`);
            try {
                await downloadImage(imageUrl, filepath);

                // Update DB object
                product.imageUri = `/product_images/${filename}`;
                successCount++;
                console.log(`  Saved to: ${filename}`);

            } catch (downloadErr) {
                console.error(`  Download failed: ${downloadErr.message}`);
                // Try fallback: Screenshot? No, let's just skip.
                errorCount++;
            }

        } catch (err) {
            console.error(`  Error processing "${productName}": ${err.message}`);
            errorCount++;
        }

        // Save periodically
        if (processedCount % SAVE_INTERVAL === 0) {
            console.log('  Saving db.json progress...');
            fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
        }

        // Delay to avoid bans
        await sleep(DELAY_MS);
    }

    // Final Save
    console.log('Saving final db.json...');
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

    await browser.close();
    console.log('-----------------------------------');
    console.log(`Finished!`);
    console.log(`Processed: ${processedCount}`);
    console.log(`Success: ${successCount}`);
    console.log(`Errors/Skipped: ${errorCount}`);

})();
