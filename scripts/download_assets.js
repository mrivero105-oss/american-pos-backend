const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const PUBLIC_DIR = path.join(__dirname, '../public');
const FONTS_DIR = path.join(PUBLIC_DIR, 'fonts');
const LIBS_DIR = path.join(PUBLIC_DIR, 'js/libs');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');
const REMOTE_CSS_PATH = path.join(PUBLIC_DIR, 'fonts_remote.css');

// Ensure directories exist
[FONTS_DIR, LIBS_DIR, CSS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function downloadFonts() {
    console.log('Processing Fonts...');
    if (!fs.existsSync(REMOTE_CSS_PATH)) {
        console.log('fonts_remote.css not found, skipping font update.');
        return;
    }

    let cssContent = fs.readFileSync(REMOTE_CSS_PATH, 'utf8');
    let localCss = cssContent;

    const fontMatches = [...cssContent.matchAll(/url\((?:'|")?(https:\/\/[^)'"]+\.(?:woff2?|ttf))(?:'|")?\)/g)];
    console.log(`Found ${fontMatches.length} font files to download.`);

    for (const match of fontMatches) {
        const url = match[1];
        const filename = path.basename(url);
        const localPath = path.join(FONTS_DIR, filename);

        try {
            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(localPath);
                https.get(url, (response) => {
                    response.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                }).on('error', (err) => { resolve(); });
            });
            localCss = localCss.split(url).join(`../fonts/${filename}`);
        } catch (e) {
            console.error(e);
        }
    }

    fs.writeFileSync(path.join(CSS_DIR, 'fonts.css'), localCss);
    console.log('fonts.css updated.');
}

async function localizeLibs() {
    console.log('Localizing Libraries...');

    // Install Toastify if missing
    try {
        console.log('Checking/Installing dependencies...');
        execSync('npm install toastify-js', { stdio: 'inherit' });
    } catch (e) { }

    const libs = [
        { name: 'html5-qrcode.min.js', src: path.join(__dirname, '../node_modules/html5-qrcode/html5-qrcode.min.js') },
        { name: 'xlsx.full.min.js', src: path.join(__dirname, '../node_modules/xlsx/dist/xlsx.full.min.js') },
        { name: 'chart.js', src: path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js') },
        { name: 'toastify.js', src: path.join(__dirname, '../node_modules/toastify-js/src/toastify.js') },
        { name: 'toastify.min.css', src: path.join(__dirname, '../node_modules/toastify-js/src/toastify.css'), destDir: CSS_DIR }
    ];

    for (const lib of libs) {
        const dest = lib.destDir ? path.join(lib.destDir, lib.name) : path.join(LIBS_DIR, lib.name);
        if (fs.existsSync(lib.src)) {
            fs.copyFileSync(lib.src, dest);
            console.log(`Copied ${lib.name} to ${dest}`);
        } else {
            console.warn(`Source not found: ${lib.src}`);
        }
    }
}

async function main() {
    await downloadFonts();
    await localizeLibs();
    console.log('Asset localization complete!');
}

main().catch(console.error);
