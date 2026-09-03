'use strict';

/**
 * Sinh icon PNG cho cửa sổ, khay hệ thống và bộ cài.
 * Chạy lại khi muốn đổi màu:  node tools/make-icon.cjs
 */

const { deflateSync } = require('node:zlib');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const SIZE = 256;
const BG = [15, 76, 129]; // xanh đậm
const FG = [255, 255, 255];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Hình chiếc thùng hàng đơn giản, vẽ bằng vài phép so sánh toạ độ. */
function pixel(x, y) {
  const cx = SIZE / 2;
  const boxLeft = SIZE * 0.24;
  const boxRight = SIZE * 0.76;
  const boxTop = SIZE * 0.3;
  const boxBottom = SIZE * 0.74;
  const stroke = SIZE * 0.055;

  const onVertical =
    (Math.abs(x - boxLeft) < stroke || Math.abs(x - boxRight) < stroke) &&
    y > boxTop - stroke &&
    y < boxBottom + stroke;
  const onHorizontal =
    (Math.abs(y - boxTop) < stroke ||
      Math.abs(y - boxBottom) < stroke ||
      Math.abs(y - (boxTop + boxBottom) / 2) < stroke * 0.7) &&
    x > boxLeft - stroke &&
    x < boxRight + stroke;
  const onSeam =
    Math.abs(x - cx) < stroke * 0.7 && y > boxTop && y < (boxTop + boxBottom) / 2;

  return onVertical || onHorizontal || onSeam ? FG : BG;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let offset = 0;
for (let y = 0; y < SIZE; y += 1) {
  raw[offset] = 0; // filter type: none
  offset += 1;
  for (let x = 0; x < SIZE; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw[offset] = r;
    raw[offset + 1] = g;
    raw[offset + 2] = b;
    raw[offset + 3] = 255;
    offset += 4;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // truecolour + alpha
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = join(__dirname, '..', 'build');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'icon.png');
writeFileSync(outFile, png);
console.log(`Đã tạo ${outFile} (${SIZE}x${SIZE}, ${png.length} bytes)`);
