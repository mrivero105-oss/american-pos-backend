const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

const replacements = [
    // Double/Triple encoding artifacts
    { regex: /ÃƒÂ¡/g, replacement: 'á' },
    { regex: /ÃƒÂ©/g, replacement: 'é' },
    { regex: /ÃƒÂí/g, replacement: 'í' },
    { regex: /ÃƒÂ³/g, replacement: 'ó' },
    { regex: /ÃƒÂº/g, replacement: 'ú' },
    { regex: /ÃƒÂ±/g, replacement: 'ñ' },

    // Static artifacts common in his file
    { regex: /Ã°Å¸â€ â€ž/g, replacement: '🔄' },
    { regex: /Ã¢â€ â€™/g, replacement: '→' },
    { regex: /Ãƒâ€œ/g, replacement: 'Ó' },
    { regex: /Ãƒâ€ /g, replacement: 'Á' },
];

let fixedCount = 0;
replacements.forEach(({ regex, replacement }) => {
    const matches = content.match(regex);
    if (matches) {
        fixedCount += matches.length;
        content = content.replace(regex, replacement);
    }
});

fs.writeFileSync(filePath, content, 'utf8');
console.log(`Global fix: Adjusted ${fixedCount} more artifacts in index.html`);
