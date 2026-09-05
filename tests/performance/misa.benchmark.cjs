'use strict';

/**
 * Đo MISA ở quy mô 12 tháng. Dùng dữ liệu tạm, không chạm CSDL thực.
 * Chạy: npm run test:performance:misa
 */

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');

const { createApp } = require('../../server/index.cjs');

const MONTH_COUNT = 12;
const ROWS_PER_MONTH = 8_000;
const TOTAL_ROWS = MONTH_COUNT * ROWS_PER_MONTH;

function milliseconds(startedAt) {
  return Number((performance.now() - startedAt).toFixed(1));
}

function seedMisa(db) {
  const at = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO misa_rows
       (document_date, customer_name, address, product_name, quantity_sold, province_city,
        source_key, source_file, imported_by, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'MISA-2026.xlsx', 1, ?)`,
  );
  db.exec('BEGIN');
  try {
    for (let index = 0; index < TOTAL_ROWS; index += 1) {
      const month = String((index % MONTH_COUNT) + 1).padStart(2, '0');
      const day = String((index % 28) + 1).padStart(2, '0');
      const customer = `Khách hàng MISA ${index % 12_000}`;
      insert.run(
        `2026-${month}-${day}`,
        customer,
        `${index + 1} Đường Dữ liệu, Quận ${index % 24}`,
        `Mặt hàng ${index % 200}`,
        (index % 40) + 1,
        `Tỉnh ${index % 30}`,
        `misa-2026-${index}`,
        at,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function request(baseUrl, token, path) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  assert.equal(response.status, 200, `${path} phải trả về 200.`);
  return { data, milliseconds: milliseconds(startedAt) };
}

async function prepareSeededAdmin(baseUrl, seeded) {
  const initialLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(seeded),
  });
  const initial = await initialLogin.json();
  assert.equal(initialLogin.status, 200, 'Không đăng nhập được cho benchmark MISA.');

  const changed = await fetch(`${baseUrl}/api/me/initial-password`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${initial.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ newPassword: 'BenchmarkAdmin123' }),
  });
  assert.equal(changed.status, 200, 'Không đổi được mật khẩu khởi tạo cho benchmark MISA.');

  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: seeded.username, password: 'BenchmarkAdmin123' }),
  });
  const profile = await login.json();
  assert.equal(login.status, 200, 'Không đăng nhập lại được cho benchmark MISA.');
  return profile;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'cuocphi-misa-performance-'));
  const app = createApp({ dbFile: join(workDir, 'benchmark.sqlite'), staticRoot: null });
  try {
    const startedAt = performance.now();
    seedMisa(app.db);
    const seedMilliseconds = milliseconds(startedAt);
    const address = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const profile = await prepareSeededAdmin(baseUrl, app.seeded);

    const coldDefault = await request(baseUrl, profile.token, '/api/misa?page=1');
    const warmDefault = await request(baseUrl, profile.token, '/api/misa?page=2');
    const byProvince = await request(
      baseUrl,
      profile.token,
      '/api/misa?province=T%E1%BB%89nh%2010&page=2',
    );
    const searched = await request(
      baseUrl,
      profile.token,
      '/api/misa?search=khach%20hang%20misa%208400&page=1',
    );

    assert.equal(coldDefault.data.count, TOTAL_ROWS);
    assert.equal(coldDefault.data.items.length, 50);
    assert.equal(warmDefault.data.items.length, 50);
    assert.ok(searched.data.count > 0, 'Tìm kiếm FTS phải có kết quả.');
    console.table([
      { endpoint: 'MISA trang đầu (tổng quan lạnh)', milliseconds: coldDefault.milliseconds },
      { endpoint: 'MISA chuyển trang (tổng quan cache)', milliseconds: warmDefault.milliseconds },
      { endpoint: 'MISA lọc tỉnh', milliseconds: byProvince.milliseconds },
      { endpoint: 'MISA tìm kiếm FTS', milliseconds: searched.milliseconds },
    ]);
    console.log(`Dataset: ${TOTAL_ROWS.toLocaleString('vi-VN')} dòng / ${MONTH_COUNT} tháng; tạo dữ liệu: ${seedMilliseconds} ms.`);
  } finally {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
