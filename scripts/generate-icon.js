const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a73e8"/>
      <stop offset="50%" stop-color="#1565c0"/>
      <stop offset="100%" stop-color="#0d47a1"/>
    </linearGradient>
    <linearGradient id="globe" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%" stop-color="#4fc3f7"/>
      <stop offset="100%" stop-color="#0288d1"/>
    </linearGradient>
    <linearGradient id="arrow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#e0f7fa" stop-opacity="0.85"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.3"/>
    </filter>
    <filter id="innerGlow">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    <clipPath id="roundRect">
      <rect x="0" y="0" width="256" height="256" rx="48" ry="48"/>
    </clipPath>
  </defs>

  <!-- Background rounded rectangle -->
  <g clip-path="url(#roundRect)">
    <rect width="256" height="256" fill="url(#bg)"/>
    <!-- Subtle radial highlight -->
    <circle cx="100" cy="80" r="180" fill="#ffffff" opacity="0.06"/>
  </g>

  <!-- Globe -->
  <g filter="url(#shadow)" transform="translate(128,132)">
    <!-- Globe body -->
    <circle cx="0" cy="0" r="58" fill="url(#globe)" opacity="0.9"/>

    <!-- Latitude lines -->
    <ellipse cx="0" cy="-28" rx="50" ry="14" fill="none" stroke="#fff" stroke-width="1.8" opacity="0.35"/>
    <ellipse cx="0" cy="0" rx="58" ry="16" fill="none" stroke="#fff" stroke-width="2" opacity="0.45"/>
    <ellipse cx="0" cy="28" rx="50" ry="14" fill="none" stroke="#fff" stroke-width="1.8" opacity="0.35"/>

    <!-- Longitude lines -->
    <ellipse cx="0" cy="0" rx="20" ry="58" fill="none" stroke="#fff" stroke-width="2" opacity="0.4"/>
    <ellipse cx="0" cy="0" rx="40" ry="58" fill="none" stroke="#fff" stroke-width="1.8" opacity="0.35"/>

    <!-- Center meridian -->
    <line x1="0" y1="-58" x2="0" y2="58" stroke="#fff" stroke-width="1.5" opacity="0.3"/>

    <!-- Highlight arc -->
    <path d="M -35,-40 A 58,58 0 0,1 35,-40" fill="none" stroke="#fff" stroke-width="3" opacity="0.25" stroke-linecap="round"/>
  </g>

  <!-- Circular refresh arrows (top-right) -->
  <g transform="translate(128,132)" filter="url(#shadow)">
    <!-- Outer ring arc -->
    <path d="M -42,-52 A 66,66 0 0,1 52,-38"
          fill="none" stroke="url(#arrow)" stroke-width="6" stroke-linecap="round"/>
    <!-- Arrow head (top) -->
    <polygon points="46,-50 60,-36 44,-32" fill="#fff" opacity="0.95"/>

    <!-- Bottom arc -->
    <path d="M 42,52 A 66,66 0 0,1 -52,38"
          fill="none" stroke="url(#arrow)" stroke-width="6" stroke-linecap="round"/>
    <!-- Arrow head (bottom) -->
    <polygon points="-46,50 -60,36 -44,32" fill="#fff" opacity="0.95"/>
  </g>

  <!-- "DNS" text at bottom -->
  <text x="128" y="228" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff" opacity="0.9" letter-spacing="4">DNS</text>
</svg>`;

const SIZES = [256, 128, 64, 48, 32, 16];

async function generatePNG(size) {
  return sharp(Buffer.from(ICON_SVG))
    .resize(size, size)
    .png()
    .toBuffer();
}

function buildICO(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let dataOffset = headerSize;
  const totalSize = dataOffset + pngBuffers.reduce((s, b) => s + b.length, 0);
  const buf = Buffer.alloc(totalSize);

  // ICO header
  buf.writeUInt16LE(0, 0);       // Reserved
  buf.writeUInt16LE(1, 2);       // Type: ICO
  buf.writeUInt16LE(count, 4);   // Image count

  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16;
    const png = pngBuffers[i];
    const w = SIZES[i] >= 256 ? 0 : SIZES[i]; // 0 means 256
    const h = w;

    buf[entryOffset] = w;
    buf[entryOffset + 1] = h;
    buf[entryOffset + 2] = 0; // Color palette
    buf[entryOffset + 3] = 0; // Reserved
    buf.writeUInt16LE(1, entryOffset + 4);    // Color planes
    buf.writeUInt16LE(32, entryOffset + 6);   // Bits per pixel
    buf.writeUInt32LE(png.length, entryOffset + 8);  // Image data size
    buf.writeUInt32LE(dataOffset, entryOffset + 12);  // Data offset

    png.copy(buf, dataOffset);
    dataOffset += png.length;
  }

  return buf;
}

async function main() {
  const electronDir = path.join(__dirname, '..', 'electron');

  console.log('Generating icon PNGs...');
  const pngBuffers = [];
  for (const size of SIZES) {
    const buf = await generatePNG(size);
    pngBuffers.push(buf);
    console.log(`  ${size}x${size} PNG: ${buf.length} bytes`);
  }

  // Save 256x256 as the main icon
  const icon256Path = path.join(electronDir, 'icon.png');
  fs.writeFileSync(icon256Path, pngBuffers[0]);
  console.log(`Written: ${icon256Path}`);

  // Build and save ICO
  const icoPath = path.join(electronDir, 'icon.ico');
  const icoBuf = buildICO(pngBuffers);
  fs.writeFileSync(icoPath, icoBuf);
  console.log(`Written: ${icoPath} (${icoBuf.length} bytes, ${SIZES.length} resolutions)`);

  console.log('Done!');
}

main().catch(e => {
  console.error('Failed to generate icon:', e);
  process.exit(1);
});
