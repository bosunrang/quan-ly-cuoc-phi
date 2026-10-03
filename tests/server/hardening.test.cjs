'use strict';

/**
 * Kiểm thử các chỗ được gia cố sau đợt rà soát hiệu năng/bảo mật:
 * giới hạn body theo route, khôi phục backup, phiên sau khi đổi mật khẩu mặc
 * định, khóa đăng nhập theo máy, khóa chuẩn hóa trên phiếu và phạm vi Tổng quan.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { createApp } = require('../../server/index.cjs');
const auth = require('../../server/auth.cjs');

let app;
let baseUrl;
let workDir;
let adminToken;
let employeeId;
let staffToken;

async function call(method, path, { token, body, raw } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body || raw ? { 'content-type': 'application/json' } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'cuocphi-hardening-'));
  app = createApp({ dbFile: join(workDir, 'test.sqlite'), staticRoot: null });
  const address = await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
  rmSync(workDir, { recursive: true, force: true });
});

test('đổi mật khẩu mặc định hủy mọi phiên khác mở bằng mật khẩu đó', async () => {
  assert.notEqual(app.seeded.password, 'admin');
  const credentials = { username: app.seeded.username, password: app.seeded.password };
  const owner = await call('POST', '/api/login', { body: credentials });
  const other = await call('POST', '/api/login', { body: credentials });
  assert.equal(owner.status, 200);
  assert.equal(other.status, 200);

  const changed = await call('POST', '/api/me/initial-password', {
    token: owner.data.token,
    body: { newPassword: 'MatKhauAdmin123' },
  });
  assert.equal(changed.status, 200);
  assert.equal((await call('GET', '/api/me', { token: other.data.token })).status, 401);
  assert.equal((await call('GET', '/api/me', { token: owner.data.token })).status, 200);
  adminToken = owner.data.token;

  const employee = await call('POST', '/api/employees', {
    token: adminToken,
    body: { fullName: 'Nhân viên Tổng quan', address: '', isActive: true },
  });
  assert.equal(employee.status, 200);
  employeeId = employee.data.id;
});

test('body thường bị giới hạn 1 MB; body lớn bị chặn quyền trước khi đọc', async () => {
  const big = JSON.stringify({ username: 'x', password: 'y'.repeat(2 * 1024 * 1024) });
  const login = await call('POST', '/api/login', { raw: big });
  assert.equal(login.status, 413);

  const user = await call('POST', '/api/users', {
    token: adminToken,
    body: { username: 'nhanvientq', fullName: 'Nhân viên Tổng quan', password: 'MatKhau123', pages: ['dashboard'] },
  });
  assert.equal(user.status, 200);
  const linked = await call('PATCH', `/api/employees/${employeeId}`, {
    token: adminToken,
    body: { fullName: 'Nhân viên Tổng quan', address: '', userId: user.data.id, isActive: true },
  });
  assert.equal(linked.status, 200);
  staffToken = (await call('POST', '/api/login', {
    body: { username: 'nhanvientq', password: 'MatKhau123' },
  })).data.token;

  const restore = await call('POST', '/api/settings/backup/restore', {
    token: staffToken,
    raw: JSON.stringify({ backup: { pad: 'x'.repeat(2 * 1024 * 1024) } }),
  });
  assert.equal(restore.status, 403);
});

test('khôi phục backup bắt buộc có đúng một dòng cài đặt hợp lệ', async () => {
  const backup = await call('GET', '/api/settings/backup', { token: adminToken });
  assert.equal(backup.status, 200);

  const broken = structuredClone(backup.data);
  broken.data.settings = [];
  const rejected = await call('POST', '/api/settings/backup/restore', {
    token: adminToken,
    body: { backup: broken },
  });
  assert.equal(rejected.status, 400);

  const badLogo = structuredClone(backup.data);
  badLogo.data.settings[0].logo_data_url = 'javascript:alert(1)';
  assert.equal((await call('POST', '/api/settings/backup/restore', {
    token: adminToken,
    body: { backup: badLogo },
  })).status, 400);

  const restored = await call('POST', '/api/settings/backup/restore', {
    token: adminToken,
    body: { backup: backup.data },
  });
  assert.equal(restored.status, 200);
  assert.equal((await call('GET', '/api/settings')).status, 200);
});

test('một máy thử sai với nhiều tên đăng nhập khác nhau cũng bị khóa', () => {
  const address = '192.168.50.9';
  for (let index = 0; index < 30; index += 1) {
    auth.recordFailedLogin(`ten-rac-${index}`, address);
  }
  assert.ok(auth.loginBlockedFor('admin', address) > 0);
  assert.equal(auth.loginBlockedFor('admin', '192.168.50.10'), 0);
});

test('đổi tên khách hàng/nhà xe vẫn giữ giá chuẩn và báo cáo chênh lệch của phiếu cũ', async () => {
  const customer = await call('POST', '/api/customers', {
    token: adminToken,
    body: { customerName: 'Khách Đổi Tên' },
  });
  const carrier = await call('POST', '/api/carriers', {
    token: adminToken,
    body: { name: 'Xe Đổi Tên' },
  });
  assert.equal(customer.status, 200);
  assert.equal(carrier.status, 200);
  await call('PATCH', `/api/carriers/${carrier.data.id}/customers`, {
    token: adminToken,
    body: { customerIds: [customer.data.id] },
  });
  const rate = await call(
    'POST',
    `/api/carriers/${carrier.data.id}/customers/${customer.data.id}/rates`,
    { token: adminToken, body: { isDefault: true, transportFee: 200000, gateFee: 0, note: '' } },
  );
  assert.equal(rate.status, 200);

  const entry = await call('POST', '/api/entries', {
    token: adminToken,
    body: {
      entryDate: '2026-08-02',
      customer: 'Khách Đổi Tên',
      carrier: 'Xe Đổi Tên',
      spec: 'Tất cả',
      transportFee: 250000,
      rateVarianceNote: 'Hàng cồng kềnh',
      note: 'Sản phẩm',
      billStatus: 'Có bill',
      employeeId,
    },
  });
  assert.equal(entry.status, 200);
  assert.equal(entry.data.standardTransportFee, 200000);

  assert.equal((await call('PATCH', `/api/customers/${customer.data.id}`, {
    token: adminToken,
    body: { customerName: 'Khách Tên Mới', carrier: 'Xe Đổi Tên' },
  })).status, 200);
  assert.equal((await call('PATCH', `/api/carriers/${carrier.data.id}`, {
    token: adminToken,
    body: { name: 'Xe Tên Mới', isActive: true },
  })).status, 200);

  const list = await call('GET', '/api/entries?from=2026-08-02&to=2026-08-02', { token: adminToken });
  const saved = list.data.items.find((item) => item.id === entry.data.id);
  assert.equal(saved.customer, 'Khách Đổi Tên', 'chữ trên phiếu giữ nguyên lịch sử');
  assert.equal(saved.standardTransportFee, 200000);

  const variance = await call(
    'GET',
    '/api/reports/carrier-variance?from=2026-08-01&to=2026-08-31',
    { token: adminToken },
  );
  assert.equal(variance.status, 200);
  const row = variance.data.items.find((item) => item.id === entry.data.id);
  assert.equal(row?.customer, 'Khách Tên Mới');
  assert.equal(row?.difference, 50000);
});

test('Tổng quan của nhân viên gồm cả phiếu Admin nhập hộ cho hồ sơ của họ', async () => {
  const dashboard = await call(
    'GET',
    '/api/dashboard?from=2026-08-01&to=2026-08-31',
    { token: staffToken },
  );
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.scope, 'own');
  assert.equal(dashboard.data.summary.entries, 1);
  assert.equal(dashboard.data.summary.transport, 250000);
});

test('tìm nhật ký trên máy chủ theo nhãn tiếng Việt và nội dung chi tiết', async () => {
  const byLabel = await call('GET', `/api/audit?q=${encodeURIComponent('xoa khach hang')}`, { token: adminToken });
  assert.equal(byLabel.status, 200);
  const byDetail = await call('GET', `/api/audit?q=${encodeURIComponent('Hàng cồng kềnh')}`, { token: adminToken });
  assert.equal(byDetail.status, 200);
  assert.ok(byDetail.data.items.some((row) => row.action === 'entry.create'));
  assert.equal(byDetail.data.total, byDetail.data.items.length);
});

test('khôi phục backup dựng lại chỉ mục tìm kiếm MISA và giữ trigger cho lần nhập sau', async () => {
  const misaRow = (sourceKey, customerName) => ({
    documentDate: '2026-08-01',
    customerName,
    productName: 'Vắc xin',
    quantitySold: 2,
    sourceKey,
  });
  const imported = await call('POST', '/api/misa/import', {
    token: adminToken,
    body: { fileName: 'misa.xlsx', rows: [misaRow('k1', 'Nhà thuốc Hồng Phúc')] },
  });
  assert.equal(imported.status, 200);
  const backup = await call('GET', '/api/settings/backup', { token: adminToken });
  assert.equal((await call('POST', '/api/settings/backup/restore', {
    token: adminToken,
    body: { backup: backup.data },
  })).status, 200);

  const afterRestore = await call('GET', `/api/misa?search=${encodeURIComponent('hong phuc')}`, { token: adminToken });
  assert.equal(afterRestore.data.count, 1);

  await call('POST', '/api/misa/import', {
    token: adminToken,
    body: { fileName: 'misa-2.xlsx', rows: [misaRow('k2', 'Phòng khám An Khang')] },
  });
  const newImport = await call('GET', `/api/misa?search=${encodeURIComponent('an khang')}`, { token: adminToken });
  assert.equal(newImport.data.count, 1);

  const cleared = await call('POST', '/api/settings/data/delete', {
    token: adminToken,
    body: { groups: ['misa'] },
  });
  assert.equal(cleared.status, 200);
  const afterDelete = await call('GET', `/api/misa?search=${encodeURIComponent('an khang')}`, { token: adminToken });
  assert.equal(afterDelete.data.count, 0);
});

test('báo cáo năm đã bỏ: máy chủ từ chối loại báo cáo annual', async () => {
  const annual = await call(
    'GET',
    `/api/reports/export?from=2026-01-01&to=2026-12-31&type=annual&employeeId=${employeeId}`,
    { token: adminToken },
  );
  assert.equal(annual.status, 400);
  const catalog = await call('GET', '/api/reports', { token: adminToken });
  assert.equal(catalog.status, 200);
  assert.equal('years' in catalog.data, false);
});

test('phiếu lưu mã khách hàng/nhà xe: sửa phiếu cũ sau khi đổi tên vẫn đúng', async () => {
  const customer = await call('POST', '/api/customers', { token: adminToken, body: { customerName: 'Khách Mã Cũ' } });
  const carrier = await call('POST', '/api/carriers', { token: adminToken, body: { name: 'Xe Mã Cũ' } });
  await call('PATCH', `/api/carriers/${carrier.data.id}/customers`, {
    token: adminToken,
    body: { customerIds: [customer.data.id] },
  });
  await call('POST', `/api/carriers/${carrier.data.id}/customers/${customer.data.id}/rates`, {
    token: adminToken,
    body: { isDefault: true, transportFee: 100000, gateFee: 0, note: '' },
  });
  const entry = await call('POST', '/api/entries', {
    token: adminToken,
    body: {
      entryDate: '2026-08-05', customer: 'Khách Mã Cũ', customerId: customer.data.id,
      carrier: 'Xe Mã Cũ', carrierId: carrier.data.id, spec: 'Tất cả', transportFee: 100000,
      note: 'Hàng', billStatus: 'Có bill', employeeId,
    },
  });
  assert.equal(entry.status, 200);
  assert.equal(entry.data.customerId, customer.data.id);
  assert.equal(entry.data.carrierId, carrier.data.id);

  await call('PATCH', `/api/customers/${customer.data.id}`, {
    token: adminToken,
    body: { customerName: 'Khách Mã Mới', carrier: 'Xe Mã Cũ' },
  });
  await call('PATCH', `/api/carriers/${carrier.data.id}`, {
    token: adminToken,
    body: { name: 'Xe Mã Mới', isActive: true },
  });

  // Form sửa phiếu nhận khách/nhà xe theo mã và gửi tên mới trong danh mục.
  const edited = await call('PATCH', `/api/entries/${entry.data.id}`, {
    token: adminToken,
    body: {
      entryDate: '2026-08-05', customer: 'Khách Mã Mới', customerId: customer.data.id,
      carrier: 'Xe Mã Mới', carrierId: carrier.data.id, spec: 'Tất cả', transportFee: 120000,
      rateVarianceNote: 'Tăng giá', note: 'Hàng', billStatus: 'Có bill', employeeId,
    },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.customer, 'Khách Mã Mới');
  assert.equal(edited.data.customerId, customer.data.id);
  assert.equal(edited.data.standardTransportFee, 100000);

  // Gửi mã của khách này kèm tên của khách khác thì bị từ chối.
  const mismatch = await call('PATCH', `/api/entries/${entry.data.id}`, {
    token: adminToken,
    body: {
      entryDate: '2026-08-05', customer: 'Khách Khác', customerId: customer.data.id,
      carrier: 'Xe Mã Mới', spec: 'Tất cả', transportFee: 100000,
      note: 'Hàng', billStatus: 'Có bill', employeeId,
    },
  });
  assert.equal(mismatch.status, 400);
});

test('phiếu của khách chưa có trong danh mục tự nối khi danh mục thêm khách đó; xóa khách thì phiếu vẫn còn', async () => {
  const entry = await call('POST', '/api/entries', {
    token: adminToken,
    body: {
      entryDate: '2026-08-06', customer: 'Khách Vãng Lai', carrier: 'Xe Vãng Lai',
      spec: 'Tất cả', transportFee: 50000, note: 'Hàng', billStatus: 'Có bill', employeeId,
    },
  });
  assert.equal(entry.status, 200);
  assert.equal(entry.data.customerId, null);

  const customer = await call('POST', '/api/customers', { token: adminToken, body: { customerName: 'Khách Vãng Lai' } });
  const listed = async () => (await call('GET', '/api/entries?from=2026-08-06&to=2026-08-06', { token: adminToken }))
    .data.items.find((item) => item.id === entry.data.id);
  assert.equal((await listed()).customerId, customer.data.id);

  assert.equal((await call('DELETE', `/api/customers/${customer.data.id}`, { token: adminToken })).status, 200);
  const afterDelete = await listed();
  assert.equal(afterDelete.customer, 'Khách Vãng Lai');
  assert.equal(afterDelete.customerId, null);
});
