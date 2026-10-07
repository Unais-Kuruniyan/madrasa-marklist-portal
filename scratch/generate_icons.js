import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPng(width, height, drawFn) {
  // RGBA buffer (4 bytes per pixel)
  const buffer = Buffer.alloc(width * height * 4);

  const setPixel = (x, y, r, g, b, a = 255) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * 4;
    buffer[idx] = r;
    buffer[idx + 1] = g;
    buffer[idx + 2] = b;
    buffer[idx + 3] = a;
  };

  const fillRect = (x0, y0, w, h, r, g, b, a = 255, rx = 0) => {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    w = Math.round(w);
    h = Math.round(h);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (rx > 0) {
          // Check rounded corner
          let cx = x < x0 + rx ? x0 + rx : x > x0 + w - rx ? x0 + w - rx : x;
          let cy = y < y0 + rx ? y0 + rx : y > y0 + h - rx ? y0 + h - rx : y;
          let distSq = (x - cx) ** 2 + (y - cy) ** 2;
          if (distSq > rx ** 2) continue;
        }
        setPixel(x, y, r, g, b, a);
      }
    }
  };

  drawFn({ width, height, setPixel, fillRect });

  // Add 1-byte filter type (0x00 = None) at start of each scanline
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    scanlines[y * (width * 4 + 1)] = 0; // Filter None
    buffer.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(scanlines);

  // Helper for PNG CRC32
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crcVal = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // PNG Signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colorType RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function drawLogo({ width, height, fillRect }, isMaskable = false) {
  // Brand background (#1e3a8a => R: 30, G: 58, B: 138)
  const rx = isMaskable ? 0 : Math.round(width * 0.22);
  fillRect(0, 0, width, height, 30, 58, 138, 255, rx);

  // Document sheet dimensions
  const scale = isMaskable ? 0.55 : 0.62;
  const docW = Math.round(width * scale);
  const docH = Math.round(height * scale * 1.15);
  const docX = Math.round((width - docW) / 2);
  const docY = Math.round((height - docH) / 2);
  const docRx = Math.round(width * 0.04);

  // White Document Sheet (#ffffff)
  fillRect(docX, docY, docW, docH, 255, 255, 255, 255, docRx);

  // Folded top-right corner
  const foldSize = Math.round(docW * 0.25);
  fillRect(docX + docW - foldSize, docY, foldSize, foldSize, 225, 235, 254, 255);

  // Blue Document Lines (#1e3a8a)
  const lineMarginX = Math.round(docW * 0.16);
  const lineW1 = Math.round(docW * 0.68);
  const lineW2 = Math.round(docW * 0.48);
  const lineH = Math.max(3, Math.round(height * 0.028));
  const lineGap = Math.round(height * 0.08);

  const startY = docY + Math.round(docH * 0.32);

  // Line 1
  fillRect(docX + lineMarginX, startY, lineW1, lineH, 30, 58, 138, 255, Math.round(lineH / 2));
  // Line 2
  fillRect(docX + lineMarginX, startY + lineGap, lineW1, lineH, 30, 58, 138, 255, Math.round(lineH / 2));
  // Line 3 (shorter)
  fillRect(docX + lineMarginX, startY + lineGap * 2, lineW2, lineH, 30, 58, 138, 255, Math.round(lineH / 2));
}

const publicDir = path.resolve(process.cwd(), 'public');

const icons = [
  { name: 'pwa-192x192.png', size: 192, maskable: false },
  { name: 'pwa-512x512.png', size: 512, maskable: false },
  { name: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const { name, size, maskable } of icons) {
  const png = createPng(size, size, (ctx) => drawLogo(ctx, maskable));
  const outPath = path.join(publicDir, name);
  fs.writeFileSync(outPath, png);
  console.log(`[IconGen] Created ${name} (${size}x${size}, maskable: ${maskable}) - ${png.length} bytes`);
}
