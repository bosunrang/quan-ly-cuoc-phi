'use strict';

/**
 * Benchmark lặp lại được cho các danh mục hay mở. Đây không phải ngưỡng CI
 * cứng (vì máy chạy khác nhau), mà là số liệu nền để so trước/sau khi tối ưu.
 *
 * Chạy: npm run test:performance
 */

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');

const { createApp } = require('../../server/index.cjs');

const CUSTOMER_COUNT = 2_000;
const CARRIER_COUNT = 500;
const EMPLOYEE_COUNT = 600;
const USER_COUNT = 300;

function percentile(values, ratio) {
  return values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
}

function seedCatalog(db) {
  const at = new Date().toISOString();
  const insertCustomer = db.prepare(
    `INSERT INTO customers
       (customer_name, carrier, recipient, address, customer_key, search_text, created_at, updated_at)
     VALUES (?, '', ?, ?, ?, ?, ?, ?)`,
  );
  const insertCarrier = db.prepare(
    `INSERT INTO carriers
       (name, contact, phone, address, schedule, note, is_active, carrier_key, created_at, updated_at)
     VALUES (?, '', '', '', '', '', 1, ?, ?, ?)`,
  );
  const insertLink = db.prepare(
    'INSERT INTO carrier_customers (carrier_id, customer_id, assigned_at) VALUES (?, ?, ?)',
  );
  const insertUser = db.prepare(
    `INSERT INTO users
       (username, password_hash, password_salt, full_name, is_admin, is_active, created_at, updated_at)
     VALUES (?, 'benchmark', 'benchmark', ?, 0, 1, ?, ?)`,
  );
  const insertPage = db.prepare('INSERT INTO user_pages (user_id, page_key) VALUES (?, ?)');
  const insertEmployee = db.prepare(
    `INSERT INTO employees
       (full_name, address, user_id, is_active, search_text, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    for (let index = 1; index <= CUSTOMER_COUNT; index += 1) {
      const name = `Khách hàng ${index}`;
      insertCustomer.run(
        name,
        `Người nhận ${index}`,
        `${index} Đường Benchmark, Quận ${index % 24}`,
        `khach hang ${index}`,
        `khach hang ${index} nguoi nhan ${index} duong benchmark quan ${index % 24}`,
        at,
        at,
      );
    }
    for (let index = 1; index <= CARRIER_COUNT; index += 1) {
      insertCarrier.run(`Nhà xe ${index}`, `nha xe ${index}`, at, at);
    }
    for (let customerId = 1; customerId <= CUSTOMER_COUNT; customerId += 1) {
      insertLink.run(((customerId - 1) % CARRIER_COUNT) + 1, customerId, at);
    }
    for (let index = 1; index <= USER_COUNT; index += 1) {
      const result = insertUser.run(`benchmark${index}`, `Tài khoản ${index}`, at, at);
      insertPage.run(Number(result.lastInsertRowid), 'employees');
    }
    for (let index = 1; index <= EMPLOYEE_COUNT; index += 1) {
      const userId = index <= USER_COUNT ? index + 1 : null;
      insertEmployee.run(
        `Nhân viên ${index}`,
        `Địa chỉ ${index % 20}`,
        userId,
        `nhan vien ${index} khu vuc ${index % 20}`,
        at,
        at,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function login(baseUrl, seeded) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: seeded.username, password: seeded.password }),
  });
  assert.equal(response.status, 200, 'Không đăng nhập được cho benchmark.');
  return response.json();
}

async function prepareSeededAdmin(baseUrl, seeded) {
  const initial = await login(baseUrl, seeded);
  const changed = await fetch(`${baseUrl}/api/me/initial-password`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${initial.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ newPassword: 'BenchmarkAdmin123' }),
  });
  assert.equal(changed.status, 200, 'Không đổi được mật khẩu khởi tạo cho benchmark.');
  return login(baseUrl, { username: seeded.username, password: 'BenchmarkAdmin123' });
}

async function measure(baseUrl, token, label, path) {
  const request = async () => {
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    assert.equal(response.status, 200, `${label} phải trả về 200.`);
    return { body, milliseconds: performance.now() - startedAt };
  };

  const warmup = await request();
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    samples.push((await request()).milliseconds);
  }
  samples.sort((a, b) => a - b);
  return {
    endpoint: label,
    warmupMs: Number(warmup.milliseconds.toFixed(1)),
    medianMs: Number(percentile(samples, 0.5).toFixed(1)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(1)),
  };
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'cuocphi-performance-'));
  const app = createApp({ dbFile: join(workDir, 'benchmark.sqlite'), staticRoot: null });
  try {
    seedCatalog(app.db);
    const address = await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const profile = await prepareSeededAdmin(baseUrl, app.seeded);
    const measurements = await Promise.all([
      measure(baseUrl, profile.token, 'Khách hàng: trang 50', '/api/customers?page=1&limit=50'),
      measure(
        baseUrl,
        profile.token,
        'Khách hàng: tìm kiếm',
        '/api/customers?search=khach%20hang%201200&page=1&limit=50',
      ),
      measure(baseUrl, profile.token, 'Nhà xe', '/api/carriers'),
      measure(baseUrl, profile.token, 'Nhân viên', '/api/employees?search=nhan%20vien'),
      measure(baseUrl, profile.token, 'Tài khoản và quyền', '/api/users'),
    ]);
    console.table(measurements);
    console.log(
      `Dataset: ${CUSTOMER_COUNT} khách hàng, ${CARRIER_COUNT} nhà xe, ${EMPLOYEE_COUNT} nhân viên, ${USER_COUNT} tài khoản.`,
    );
  } finally {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
