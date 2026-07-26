// dodgeball.html と各アセットを www/ に変換コピーするビルドスクリプト
// - index.html にリネーム
// - Three.js の CDN 参照をローカルバンドル(three.min.js)に置換
// 使い方: node build-www.js  (dodgeball-app/ 内で実行)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');       // C:\Users\gamey\python
const WWW = path.join(__dirname, 'www');

fs.mkdirSync(WWW, { recursive: true });

// 1. dodgeball.html → www/index.html（CDN参照を全てローカルに置換）
//    アプリ版は起動時に通信を必要としない状態にする（CDN待ちで操作不能になるのを防ぐ）
let html = fs.readFileSync(path.join(SRC, 'dodgeball.html'), 'utf8');
const LOCALIZE = [
  { re: /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, to: 'three.min.js' },
  { re: /https:\/\/www\.gstatic\.com\/firebasejs\/10\.14\.1\/firebase-app-compat\.js/, to: 'firebase-app-compat.js' },
  { re: /https:\/\/www\.gstatic\.com\/firebasejs\/10\.14\.1\/firebase-auth-compat\.js/, to: 'firebase-auth-compat.js' },
  { re: /https:\/\/www\.gstatic\.com\/firebasejs\/10\.14\.1\/firebase-firestore-compat\.js/, to: 'firebase-firestore-compat.js' },
];
for (const { re, to } of LOCALIZE) {
  const before = html;
  html = html.replace(re, to);
  if (html === before) {
    console.error('ERROR: CDN reference not found for', to, '— check dodgeball.html');
    process.exit(1);
  }
}
if (/https:\/\/(cdnjs|www\.gstatic)/.test(html)) {
  console.error('ERROR: 未置換のCDN参照が残っています');
  process.exit(1);
}
fs.writeFileSync(path.join(WWW, 'index.html'), html);
console.log('index.html written (Three.js + Firebase localized)');

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

// 3. ローカル化したライブラリの存在チェック（未取得なら fetch-three.js でダウンロード）
const LIBS = ['three.min.js', 'firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
for (const lib of LIBS) {
  if (!fs.existsSync(path.join(WWW, lib))) {
    console.error(`MISSING: www/${lib} — run: node fetch-three.js`);
    process.exit(1);
  }
}
console.log('build complete');
