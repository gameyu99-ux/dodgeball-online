// Three.js r128 をダウンロードして www/ にバンドルする（初回のみ実行）
const https = require('https');
const fs = require('fs');
const path = require('path');

const URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const OUT = path.join(__dirname, 'www', 'three.min.js');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
https.get(URL, res => {
  if (res.statusCode !== 200) { console.error('HTTP', res.statusCode); process.exit(1); }
  const ws = fs.createWriteStream(OUT);
  res.pipe(ws);
  ws.on('finish', () => {
    const kb = Math.round(fs.statSync(OUT).size / 1024);
    console.log(`three.min.js downloaded (${kb} KB)`);
  });
}).on('error', e => { console.error(e.message); process.exit(1); });
