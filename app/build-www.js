// dodgeball.html と各アセットを www/ に変換コピーするビルドスクリプト
// - index.html にリネーム
// - Three.js の CDN 参照をローカルバンドル(three.min.js)に置換
// 使い方: node build-www.js  (dodgeball-app/ 内で実行)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');       // C:\Users\gamey\python
const WWW = path.join(__dirname, 'www');

fs.mkdirSync(WWW, { recursive: true });

// 1. dodgeball.html → www/index.html（CDN参照をローカルに置換）
let html = fs.readFileSync(path.join(SRC, 'dodgeball.html'), 'utf8');
const before = html;
html = html.replace(
  /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/,
  'three.min.js'
);
if (html === before) {
  console.error('WARNING: Three.js CDN reference not found — check dodgeball.html');
}
fs.writeFileSync(path.join(WWW, 'index.html'), html);
console.log('index.html written (Three.js localized)');

// 2. アセットコピー
const assets = ['bg.jpg', 'title-logo.png', 'bgm-menu.mp3', 'bgm-game.mp3'];
for (const a of assets) {
  const from = path.join(SRC, a);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(WWW, a));
    console.log('copied:', a);
  } else {
    console.error('MISSING asset:', a);
  }
}

// 3. three.min.js の存在チェック（初回は fetch-three.js でダウンロード）
if (!fs.existsSync(path.join(WWW, 'three.min.js'))) {
  console.error('MISSING: www/three.min.js — run: node fetch-three.js');
  process.exit(1);
}
console.log('build complete');
