// 外部ライブラリ(Three.js / Firebase)をダウンロードして www/ にバンドルする
// アプリ版では起動時に一切ネットワークを必要としないようにするため、CDN参照を全てローカル化する
// （CDNのままだと通信が遅い/届かない環境で index.html のパースが止まり、ボタンが無反応になる）
const https = require('https');
const fs = require('fs');
const path = require('path');

const WWW = path.join(__dirname, 'www');
const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';

const LIBS = [
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', out: 'three.min.js' },
  { url: FB + 'firebase-app-compat.js',       out: 'firebase-app-compat.js' },
  { url: FB + 'firebase-auth-compat.js',      out: 'firebase-auth-compat.js' },
  { url: FB + 'firebase-firestore-compat.js', out: 'firebase-firestore-compat.js' },
];

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      // gstaticはリダイレクトを返すことがある
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (redirects > 4) return reject(new Error('too many redirects: ' + url));
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => resolve(Math.round(fs.statSync(dest).size / 1024)));
      ws.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(WWW, { recursive: true });
  for (const lib of LIBS) {
    const dest = path.join(WWW, lib.out);
    const kb = await download(lib.url, dest);
    console.log(`${lib.out} downloaded (${kb} KB)`);
  }
  console.log('all libraries bundled');
})().catch(e => { console.error(e.message); process.exit(1); });
