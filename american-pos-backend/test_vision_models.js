const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testAllModels() {
    const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) {
        console.error('❌ Define GOOGLE_API_KEY o GEMINI_API_KEY en .env antes de ejecutar este script.');
        process.exit(1);
    }
    const genAI = new GoogleGenerativeAI(key);
    const imgBuffer = fs.readFileSync('test_canon_scan.jpg');
    
    const models = [
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.6-flash',
        'gemini-3.7-flash',
        'gemini-3-flash-preview'
    ];

    for (const mName of models) {
        console.log(`\nProbando modelo: ${mName}...`);
        const t0 = Date.now();
        try {
            const m = genAI.getGenerativeModel({ model: mName });
            const res = await m.generateContent([
                { text: 'Extrae el nombre de los productos o texto de esta imagen en 1 linea:' },
                {
                    inlineData: {
                        data: imgBuffer.toString('base64'),
                        mimeType: 'image/jpeg'
                    }
                }
            ]);
            console.log(`[SUCCESS] ${mName} tardó ${(Date.now() - t0)}ms -> Res:`, res.response.text().slice(0, 150));
            break;
        } catch (err) {
            console.log(`[FAIL] ${mName} (${(Date.now() - t0)}ms) -> Error:`, err.message);
        }
    }
}

testAllModels();
