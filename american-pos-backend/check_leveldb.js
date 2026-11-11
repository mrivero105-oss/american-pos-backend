const fs = require('fs');
const path = require('path');

function inspectProfile(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f.endsWith('.ldb') || f.endsWith('.log')) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      const idx = content.indexOf('isaac_pos_saved_user_profile');
      if (idx !== -1) {
        console.log('--- FOUND in', f, '---');
        console.log(content.substring(idx, idx + 300));
      }
      const tokenIdx = content.indexOf('token');
      if (tokenIdx !== -1) {
        const tokenMatch = content.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g);
        if (tokenMatch) {
          console.log('JWT Tokens found in', f, tokenMatch.length);
          const jwt = require('jsonwebtoken');
          tokenMatch.forEach(t => {
            try {
              console.log('Decoded token:', jwt.decode(t));
            } catch(e) {}
          });
        }
      }
    }
  }
}

inspectProfile('C:/Users/mrive/AppData/Roaming/isaac-pos/Local Storage/leveldb');
