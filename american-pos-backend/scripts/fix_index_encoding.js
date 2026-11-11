const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

const replacements = [
    { regex: /ÃƒÂ¡/g, replacement: 'á' },
    { regex: /ÃƒÂ©/g, replacement: 'é' },
    { regex: /ÃƒÂ­/g, replacement: 'í' },
    { regex: /ÃƒÂ³/g, replacement: 'ó' },
    { regex: /ÃƒÂº/g, replacement: 'ú' },
    { regex: /ÃƒÂ±/g, replacement: 'ñ' },
    { regex: /ÃƒÂ/g, replacement: 'Á' }, // Likely start of uppercase if followed by something else, but tricky
    // Add specific artifacts seen in line 113
    { regex: /Ã°Å¸â€â€ž/g, replacement: '🔄' }, // Emoji repair
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
console.log(`Fixed ${fixedCount} encoding artifacts in index.html`);
