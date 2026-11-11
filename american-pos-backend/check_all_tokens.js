const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

function dumpAllTokens(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f.endsWith('.ldb') || f.endsWith('.log')) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      const matches = content.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g);
      if (matches) {
        matches.forEach(t => {
          try {
            const dec = jwt.decode(t);
            console.log(`File ${f}: id=${dec.id}, username=${dec.username || dec.email}, companyId=${dec.companyId}, iat=${new Date(dec.iat*1000).toISOString()}`);
          } catch(e) {}
        });
      }
    }
  }
}

dumpAllTokens('C:/Users/mrive/AppData/Roaming/isaac-pos/Local Storage/leveldb');
