'use strict';

/** Khôi phục từ bản sao lưu SQLite máy chủ tự tạo, ngay trong ứng dụng. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { createApp } = require('../../server/index.cjs');
const { createAutomaticBackup } = require('../../server/automatic-backup.cjs');

let app;
let baseUrl;
let workDir;
let backupDir;
let adminToken;

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

const customerNames = async () =>
  (await call('GET', '/api/customers?page=1&limit=50', { token: adminToken }))
    .data.items.map((item) => item.customerName)
    .sort();

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'cuocphi-auto-restore-'));
  backupDir = join(workDir, 'backups');
  app = createApp({
    dbFile: join(workDir, 'cost-app.sqlite'),
    staticRoot: null,
    automaticBackupDir: backupDir,
  });
  const address = await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${address.port}`;
  const login = await call('POST', '/api/login', {
    body: { username: app.seeded.username, password: app.seeded.password },
  });
  await call('POST', '/api/me/initial-password', {
    token: login.data.token,
    body: { newPassword: 'MatKhauAdmin123' },
  });
  adminToken = login.data.token;
});

after(async () => {
  await app.close();
  rmSync(workDir, { recursive: true, force: true });
});

test('khôi phục bản sao lưu tự động, có bản chụp an toàn để hoàn tác', async () => {
  await call('POST', '/api/customers', { token: adminToken, body: { customerName: 'Khách Cũ' } });
  // Bản sao lưu "hôm qua" chỉ có Khách Cũ.
  const daily = await createAutomaticBackup(app.db, join(workDir, 'cost-app.sqlite'), backupDir, {
    date: new Date(2026, 9, 1, 8, 0),
  });
  await call('POST', '/api/customers', { token: adminToken, body: { customerName: 'Khách Mới' } });
  assert.deepEqual(await customerNames(), ['Khách Cũ', 'Khách Mới']);

  const list = await call('GET', '/api/settings/automatic-backups', { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.data.enabled, true);
  const item = list.data.items.find((backup) => backup.date === '2026-10-01');
  assert.equal(item.date, '2026-10-01');
  assert.ok(daily.path.endsWith(item.fileName));

  const restored = await call('POST', '/api/settings/automatic-backups/restore', {
    token: adminToken,
    body: { fileName: item.fileName },
  });
  assert.equal(restored.status, 200);
  assert.deepEqual(await customerNames(), ['Khách Cũ']);

  // Bản chụp ngay trước khi khôi phục vẫn còn dữ liệu cũ, khôi phục lại được.
  const afterList = await call('GET', '/api/settings/automatic-backups', { token: adminToken });
  const safety = afterList.data.items.find((backup) => backup.kind === 'before-restore');
  assert.ok(safety, 'phải có bản chụp trước khi khôi phục');
  const undo = await call('POST', '/api/settings/automatic-backups/restore', {
    token: adminToken,
    body: { fileName: safety.fileName },
  });
  assert.equal(undo.status, 200);
  assert.deepEqual(await customerNames(), ['Khách Cũ', 'Khách Mới']);

  const audit = await call('GET', '/api/audit?limit=5', { token: adminToken });
  assert.equal(audit.data.items[0].action, 'settings.automatic_backup_restore');
  assert.equal(audit.data.items[0].detail.fileName, safety.fileName);
});

test('chỉ nhận đúng tên file trong danh sách, không nhận đường dẫn', async () => {
  for (const fileName of ['../cost-app.sqlite', 'cost-app.sqlite', '', 'C:\\Windows\\win.ini']) {
    const result = await call('POST', '/api/settings/automatic-backups/restore', {
      token: adminToken,
      body: { fileName },
    });
    assert.equal(result.status, 400, fileName);
  }
  // Không có tệp tạm nào bị bỏ lại trong thư mục sao lưu.
  assert.equal(readdirSync(backupDir).some((name) => name.includes('.tmp-')), false);
});

test('nhân viên không xem hay khôi phục được bản sao lưu', async () => {
  const user = await call('POST', '/api/users', {
    token: adminToken,
    body: { username: 'nhanvien', fullName: 'Nhân viên', password: 'MatKhau123', pages: ['entries'] },
  });
  assert.equal(user.status, 200);
  const staff = await call('POST', '/api/login', {
    body: { username: 'nhanvien', password: 'MatKhau123' },
  });
  assert.equal((await call('GET', '/api/settings/automatic-backups', { token: staff.data.token })).status, 403);
  assert.equal((await call('POST', '/api/settings/automatic-backups/restore', {
    token: staff.data.token,
    body: { fileName: 'x' },
  })).status, 403);
});
