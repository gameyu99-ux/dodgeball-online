// アプリアイコン/スプラッシュの元画像をSVGから生成する（@capacitor/assets同梱のsharpを使用）
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ドッジボール: 濃紺コートにオレンジのボール
const iconSvg = `
<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#252550"/>
      <stop offset="100%" stop-color="#12122a"/>
    </linearGradient>
    <radialGradient id="ball" cx="0.35" cy="0.3" r="1">
      <stop offset="0%" stop-color="#ffa050"/>
      <stop offset="55%" stop-color="#ff6622"/>
      <stop offset="100%" stop-color="#cc4411"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <!-- コートライン -->
  <line x1="0" y1="780" x2="1024" y2="780" stroke="#ffffff" stroke-opacity="0.35" stroke-width="14"/>
  <line x1="512" y1="780" x2="512" y2="1024" stroke="#ffffff" stroke-opacity="0.25" stroke-width="10"/>
  <!-- トレイル -->
  <circle cx="240" cy="560" r="60" fill="#ffcc00" fill-opacity="0.15"/>
  <circle cx="330" cy="500" r="80" fill="#ffcc00" fill-opacity="0.25"/>
  <circle cx="430" cy="450" r="100" fill="#ffcc00" fill-opacity="0.35"/>
  <!-- ボール -->
  <circle cx="600" cy="420" r="230" fill="url(#ball)"/>
  <path d="M 380 380 Q 600 300 820 380" stroke="#aa3300" stroke-width="16" fill="none" stroke-opacity="0.6"/>
  <path d="M 380 470 Q 600 550 820 470" stroke="#aa3300" stroke-width="16" fill="none" stroke-opacity="0.6"/>
  <ellipse cx="520" cy="330" rx="70" ry="45" fill="#ffffff" fill-opacity="0.35"/>
</svg>`;

// スプラッシュ: 中央にボール（2732x2732、余白多め）
const splashSvg = `
<svg width="2732" height="2732" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="ball" cx="0.35" cy="0.3" r="1">
      <stop offset="0%" stop-color="#ffa050"/>
      <stop offset="55%" stop-color="#ff6622"/>
      <stop offset="100%" stop-color="#cc4411"/>
    </radialGradient>
  </defs>
  <rect width="2732" height="2732" fill="#1a1a2e"/>
  <circle cx="1366" cy="1366" r="300" fill="url(#ball)"/>
  <ellipse cx="1260" cy="1250" rx="90" ry="60" fill="#ffffff" fill-opacity="0.35"/>
</svg>`;

(async () => {
  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(ASSETS, 'icon-only.png'));
  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(ASSETS, 'icon-foreground.png'));
  await sharp(Buffer.from(splashSvg)).png().toFile(path.join(ASSETS, 'splash.png'));
  await sharp(Buffer.from(splashSvg)).png().toFile(path.join(ASSETS, 'splash-dark.png'));
  console.log('assets generated: icon-only.png / icon-foreground.png / splash.png / splash-dark.png');
})().catch(e => { console.error(e); process.exit(1); });
