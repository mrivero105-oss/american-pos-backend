const fs = require('fs');

const files = [
  'C:/Users/mrive/AppData/Roaming/isaac-pos/settings.json',
  'C:/Users/mrive/AppData/Roaming/americanpos/settings.json',
  './settings.json'
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (data['2']) {
        data['default'] = JSON.parse(JSON.stringify(data['2']));
        fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
        console.log('Updated default in', f, 'to match company 2 (Rate:', data['2'].exchangeRate, ')');
      }
    } catch(e) {
      console.error('Error in', f, e.message);
    }
  }
});
