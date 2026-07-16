const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// Use hex codes to be sure
const replacements = [
    { regex: /\xC3\xB0\xC5\xB8\xE2\€\ \xE2\€\ž/g, replacement: '🔄' }, // This is hard
];

// Let's just use string literal from the file
const badEmoji = 'Ã°Å¸â€â€ž';
if (content.includes(badEmoji)) {
    content = content.split(badEmoji).join('🔄');
    console.log('Fixed bad emoji artifact');
}

const badArrow = 'Ã¢â€â€™';
if (content.includes(badArrow)) {
    content = content.split(badArrow).join('→');
    console.log('Fixed bad arrow artifact');
}

fs.writeFileSync(filePath, content, 'utf8');
