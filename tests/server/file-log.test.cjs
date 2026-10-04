'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { installFileLogging } = require('../../server/file-log.cjs');
const { sendError } = require('../../server/http.cjs');

function quietConsole(work) {
  // Tránh in log thử nghiệm ra màn hình test, nhưng vẫn để file log ghi.
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  return Promise.resolve(work()).finally(() => Object.assign(console, original));
}

test('lỗi máy chủ được ghi ra file log theo ngày, kèm thao tác gây lỗi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuocphi-log-'));
  try {
    await quietConsole(async () => {
      const log = installFileLogging(dir, { now: () => new Date(2026, 9, 4, 9, 30) });
      const res = { writeHead() {}, end() {} };
      sendError(res, new Error('Hỏng khi xuất báo cáo'), 'GET /api/reports/export');
      console.log('Đã tạo backup tự động');
      await log.close();
    });
    const content = readFileSync(join(dir, 'app-2026-10-04.log'), 'utf8');
    assert.match(content, /\[ERROR\] \[loi\] GET \/api\/reports\/export Error: Hỏng khi xuất báo cáo/);
    assert.match(content, /at /, 'phải có stack trace để tra lỗi');
    assert.match(content, /\[INFO\] Đã tạo backup tự động/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chỉ giữ số ngày log quy định và chặn log tràn trong một ngày', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuocphi-log-'));
  try {
    for (let day = 1; day <= 9; day += 1) {
      writeFileSync(join(dir, `app-2026-09-0${day}.log`), 'cũ\n');
    }
    writeFileSync(join(dir, 'ghi-chu.txt'), 'không phải log');
    await quietConsole(async () => {
      const log = installFileLogging(dir, {
        retention: 3,
        maxBytesPerDay: 200,
        now: () => new Date(2026, 9, 4, 8, 0),
      });
      for (let index = 0; index < 50; index += 1) console.error('Lỗi lặp lại', index);
      await log.close();
    });
    const files = readdirSync(dir).sort();
    assert.deepEqual(files, ['app-2026-09-08.log', 'app-2026-09-09.log', 'app-2026-10-04.log', 'ghi-chu.txt']);
    const today = readFileSync(join(dir, 'app-2026-10-04.log'), 'utf8');
    assert.ok(Buffer.byteLength(today) < 500);
    assert.match(today, /Đã đạt giới hạn dung lượng log/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
