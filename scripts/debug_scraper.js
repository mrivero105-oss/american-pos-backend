const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log('Starting debug scraper...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const query = "Coca Cola";
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&iax=images&ia=images`;

    console.log(`Navigating to ${searchUrl}...`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Taking screenshot...');
    await page.screenshot({ path: 'debug_screenshot.png' });

    console.log('Dumping HTML...');
    const html = await page.content();
    fs.writeFileSync('debug_page.html', html);

    console.log('Checking selectors...');
    const tileCount = await page.$$eval('.tile--img__img', els => els.length);
    console.log(`.tile--img__img count: ${tileCount}`);

    const imgCount = await page.$$eval('img', els => els.length);
    console.log(`Total img tags: ${imgCount}`);

    // Try to find any image that looks like a result
    const possibleImages = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).map(img => ({
            src: img.src,
            class: img.className,
            alt: img.alt
        })).slice(0, 10);
    });
    console.log('First 10 images:', JSON.stringify(possibleImages, null, 2));

    await browser.close();
    console.log('Done.');
})();
