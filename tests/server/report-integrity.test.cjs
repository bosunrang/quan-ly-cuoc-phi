'use strict';

/**
 * Số liệu báo cáo phải khớp với dữ liệu đã nhập, kể cả sau khi danh mục thay
 * đổi: nhân viên nghỉ việc, sửa/xóa bảng cước, nhập MISA nhiều lô, kỳ xăng vắt
 * qua hai tháng.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { createApp } = require('../../server/index.cjs');

let app;
let baseUrl;
let workDir;
let adminToken;

async function call(method, path, { token = adminToken, body } = {}) {
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

async function createEmployee(fullName) {
  const employee = await call('POST', '/api/employees', {
    body: { fullName, address: '', isActive: true },
  });
  assert.equal(employee.status, 200);
  return employee.data;
}

async function deactivate(employee) {
  const updated = await call('PATCH', `/api/employees/${employee.id}`, {
    body: { fullName: employee.fullName, address: '', userId: null, isActive: false },
  });
  assert.equal(updated.status, 200);
}

const entryBody = (overrides) => ({
  entryDate: '2026-10-02',
  customer: 'Khách lẻ',
  carrier: 'Xe lẻ',
  spec: 'Thùng',
  transportFee: 10000,
  note: 'Hàng',
  billStatus: 'Có bill',
  ...overrides,
});

async function createEntry(overrides) {
  const entry = await call('POST', '/api/entries', { body: entryBody(overrides) });
  assert.equal(entry.status, 200, JSON.stringify(entry.data));
  return entry.data;
}

const fuelBody = (overrides) => ({
  consumptionLiters: 1,
  consumptionBaseKm: 40,
  vehicleType: 'motorcycle',
  fuelPrice: 20000,
  legs: [{ from: 'Kho công ty', to: 'Bệnh viện Fuel', km: 40 }],
  ...overrides,
});

const sheetCells = (sheet) => sheet.rows.flatMap((row) => row.cells.map((cell) => cell.value));

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'cuocphi-report-integrity-'));
  app = createApp({ dbFile: join(workDir, 'test.sqlite'), staticRoot: null });
  const address = await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${address.port}`;
  const login = await call('POST', '/api/login', {
    token: null,
    body: { username: app.seeded.username, password: app.seeded.password },
  });
  const changed = await call('POST', '/api/me/initial-password', {
    token: login.data.token,
    body: { newPassword: 'MatKhauAdmin123' },
  });
  assert.equal(changed.status, 200);
  adminToken = login.data.token;
});

after(async () => {
  await app.close();
  rmSync(workDir, { recursive: true, force: true });
});

test('báo cáo gồm nhân viên đã nghỉ và phiếu chưa gán nhân viên; Admin vẫn sửa được phiếu cũ', async () => {
  const leaving = await createEmployee('Người Nghỉ Việc');
  const staying = await createEmployee('Người Đang Làm');
  const oldEntry = await createEntry({ employeeId: leaving.id, transportFee: 100000 });
  await createEntry({ employeeId: leaving.id, transportFee: 50000, customer: 'Khách 2' });
  await createEntry({ employeeId: staying.id, transportFee: 30000, customer: 'Khách 3' });
  const orphan = await createEntry({
    employeeId: staying.id,
    transportFee: 20000,
    customer: 'Khách 4',
  });
  app.db.prepare('UPDATE entries SET employee_id = NULL WHERE id = ?').run(orphan.id);
  await deactivate(leaving);

  const range = 'from=2026-10-01&to=2026-10-31&type=daily';
  const all = await call('GET', `/api/reports/print?${range}`);
  assert.equal(all.status, 200, JSON.stringify(all.data));
  const names = all.data.sheets.map((sheet) => sheet.name);
  assert.ok(names.includes('Người Nghỉ Việc'), names.join(', '));
  assert.ok(names.includes('Chưa gán nhân viên'), names.join(', '));
  // Tổng hợp khớp với danh sách phiếu: 100k + 50k + 30k + 20k.
  const list = await call('GET', '/api/entries?from=2026-10-01&to=2026-10-31');
  assert.equal(list.data.total, 200000);
  assert.ok(sheetCells(all.data.sheets[0]).includes('200.000'));

  const single = await call('GET', `/api/reports/print?${range}&employeeId=${leaving.id}`);
  assert.equal(single.status, 200, JSON.stringify(single.data));
  assert.equal(single.data.sheets.length, 1);

  const catalog = await call('GET', '/api/reports');
  assert.ok(catalog.data.employees.some((item) => item.fullName === 'Người Nghỉ Việc (đã nghỉ)'));

  // Sửa lỗi nhập liệu mà vẫn giữ người phụ trách đã nghỉ.
  const edited = await call('PATCH', `/api/entries/${oldEntry.id}`, {
    body: entryBody({ employeeId: leaving.id, transportFee: 110000 }),
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.employeeId, leaving.id);
  // Đã chuyển phiếu sang người khác thì không gán ngược lại cho người đã nghỉ.
  const reassigned = await call('PATCH', `/api/entries/${edited.data.id}`, {
    body: entryBody({ employeeId: staying.id }),
  });
  assert.equal(reassigned.status, 200);
  const reassignBack = await call('PATCH', `/api/entries/${edited.data.id}`, {
    body: entryBody({ employeeId: leaving.id }),
  });
  assert.equal(reassignBack.status, 400);
});

test('sửa, xóa bảng cước hay xóa nhà xe không đổi chênh lệch của phiếu cũ', async () => {
  const employee = await createEmployee('Nhân viên Chênh Lệch');
  const customer = await call('POST', '/api/customers', {
    body: { customerName: 'Khách Chênh Lệch' },
  });
  const carrier = await call('POST', '/api/carriers', { body: { name: 'Xe Chênh Lệch' } });
  await call('PATCH', `/api/carriers/${carrier.data.id}/customers`, {
    body: { customerIds: [customer.data.id] },
  });
  const ratePath = `/api/carriers/${carrier.data.id}/customers/${customer.data.id}/rates`;
  const rate = await call('POST', ratePath, {
    body: { isDefault: true, transportFee: 100000, gateFee: 0, note: '' },
  });
  assert.equal(rate.status, 200);

  const september = await createEntry({
    entryDate: '2026-09-15',
    customer: 'Khách Chênh Lệch',
    carrier: 'Xe Chênh Lệch',
    spec: 'Tất cả',
    transportFee: 120000,
    rateVarianceNote: 'Hàng cồng kềnh',
    employeeId: employee.id,
  });
  assert.equal(september.standardTransportFee, 100000);

  // Tháng 10 tăng giá chuẩn lên 120k.
  const raised = await call('PATCH', `${ratePath}/${rate.data.id}`, {
    body: { isDefault: true, transportFee: 120000, gateFee: 0, note: '' },
  });
  assert.equal(raised.status, 200);

  const septemberRange = 'from=2026-09-01&to=2026-09-30';
  let variance = await call('GET', `/api/reports/carrier-variance?${septemberRange}`);
  assert.equal(variance.data.summary.entries, 1);
  assert.equal(variance.data.items[0].standardFee, 100000);
  assert.equal(variance.data.items[0].difference, 20000);
  let dashboard = await call('GET', `/api/dashboard?${septemberRange}`);
  assert.equal(dashboard.data.summary.varianceEntries, 1);
  assert.equal(dashboard.data.monthlyVariance[0].difference, 20000);

  // Phiếu mới dùng giá mới; sửa phiếu cũ (không đổi khách/nhà xe/quy cách) giữ giá cũ.
  const october = await createEntry({
    entryDate: '2026-10-15',
    customer: 'Khách Chênh Lệch',
    carrier: 'Xe Chênh Lệch',
    spec: 'Tất cả',
    transportFee: 120000,
    employeeId: employee.id,
  });
  assert.equal(october.standardTransportFee, 120000);
  const editedOld = await call('PATCH', `/api/entries/${september.id}`, {
    body: entryBody({
      entryDate: '2026-09-15',
      customer: 'Khách Chênh Lệch',
      carrier: 'Xe Chênh Lệch',
      spec: 'Tất cả',
      transportFee: 125000,
      rateVarianceNote: 'Hàng cồng kềnh',
      employeeId: employee.id,
    }),
  });
  assert.equal(editedOld.status, 200, JSON.stringify(editedOld.data));
  assert.equal(editedOld.data.standardTransportFee, 100000);

  // Xóa luôn nhà xe: phiếu cũ vẫn nằm trong báo cáo, mang tên nhà xe trên phiếu.
  assert.equal((await call('DELETE', `/api/carriers/${carrier.data.id}`)).status, 200);
  variance = await call('GET', `/api/reports/carrier-variance?${septemberRange}`);
  assert.equal(variance.data.summary.entries, 1);
  assert.equal(variance.data.items[0].carrier, 'Xe Chênh Lệch');
  assert.equal(variance.data.items[0].difference, 25000);
  dashboard = await call('GET', `/api/dashboard?${septemberRange}`);
  assert.equal(dashboard.data.summary.varianceEntries, 1);
});

test('khôi phục backup cũ chưa có giá chuẩn trên phiếu thì chốt theo bảng cước trong backup', async () => {
  const employee = await createEmployee('Nhân viên Backup');
  const customer = (
    await call('POST', '/api/customers', { body: { customerName: 'Khách Backup' } })
  ).data;
  const carrier = (await call('POST', '/api/carriers', { body: { name: 'Xe Backup' } })).data;
  const entry = await createEntry({
    customer: 'Khách Backup',
    carrier: 'Xe Backup',
    spec: 'Tất cả',
    employeeId: employee.id,
  });
  assert.equal(entry.standardTransportFee, null);

  // Backup trước bản này: phiếu chưa có cột giá chuẩn, bảng cước đã có giá 7.000.
  const backup = await call('GET', '/api/settings/backup');
  assert.equal(backup.status, 200);
  const legacy = structuredClone(backup.data);
  for (const row of legacy.data.entries) delete row.standard_transport_fee;
  legacy.data.carrierRates.push({
    id: 9999,
    carrier_id: carrier.id,
    customer_id: customer.id,
    spec: 'Tất cả',
    spec_key: '__all__',
    is_default: 1,
    transport_fee: 7000,
    gate_fee: 0,
    note: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });

  const restored = await call('POST', '/api/settings/backup/restore', {
    body: { backup: legacy },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  const row = app.db
    .prepare('SELECT standard_transport_fee FROM entries WHERE id = ?')
    .get(entry.id);
  assert.equal(row.standard_transport_fee, 7000);
});

test('MISA: hai dòng cùng hóa đơn, mã hàng, số lượng nhưng khác lô đều được lưu', async () => {
  const row = (lot, rowNumber, customerName = 'Bệnh viện Lô') => ({
    rowNumber,
    documentDate: '2026-10-05',
    documentCode: 'HD-LO',
    customerCode: 'KH-LO',
    customerName,
    address: 'Địa chỉ',
    productCode: 'SP-LO',
    productName: 'Sản phẩm Lô',
    quantitySold: 10,
    provinceCity: 'Cần Thơ',
    sourceKey: `2026-10-05|hd-lo|kh-lo|${customerName}|dia chi|sp-lo|${lot}|10`,
    status: 'ready',
    reason: '',
  });
  const count = () =>
    app.db.prepare("SELECT COUNT(*) AS count FROM misa_rows WHERE document_code = 'HD-LO'").get()
      .count;
  const importRows = (rows) =>
    call('POST', '/api/misa/import', { body: { fileName: 'misa.xlsx', rows } });

  const preview = await call('POST', '/api/misa/preview', {
    body: { fileName: 'misa.xlsx', rows: [row('l1', 1), row('l2', 2)] },
  });
  assert.equal(preview.data.readyCount, 2);
  assert.equal((await importRows([row('l1', 1), row('l2', 2)])).data.inserted, 2);
  assert.equal(count(), 2);

  // Nhập lại đúng file, hoặc file xuất lại khi tên khách và số lô đã đổi: không nhân đôi.
  assert.equal((await importRows([row('l1', 1), row('l2', 2)])).data.inserted, 0);
  assert.equal(
    (await importRows([row('l7', 1, 'Tên mới'), row('l8', 2, 'Tên mới')])).data.inserted,
    0,
  );
  assert.equal(count(), 2);

  // File mới có thêm lô thứ ba của cùng mặt hàng: chỉ dòng đó được thêm.
  const third = await call('POST', '/api/misa/preview', {
    body: { fileName: 'misa.xlsx', rows: [row('l1', 1), row('l2', 2), row('l3', 3)] },
  });
  assert.equal(third.data.readyCount, 1);
  assert.equal((await importRows([row('l1', 1), row('l2', 2), row('l3', 3)])).data.inserted, 1);
  assert.equal(count(), 3);
});

test('kỳ xăng vắt qua hai tháng được tính ở tháng kết thúc, khớp với Tổng quan', async () => {
  const employee = await createEmployee('Nhân viên Xăng Cuối Tháng');
  const record = await call('POST', '/api/fuel/records', {
    body: fuelBody({ employeeId: employee.id, periodFrom: '2026-09-28', periodTo: '2026-10-03' }),
  });
  assert.equal(record.status, 200, JSON.stringify(record.data));
  assert.equal(record.data.totalFee, 20000);

  const history = (from, to) =>
    call('GET', `/api/reports/fuel-history?from=${from}&to=${to}&employeeId=${employee.id}`);
  assert.equal((await history('2026-09-01', '2026-09-30')).data.recordsTotal, 0);
  const october = await history('2026-10-01', '2026-10-31');
  assert.equal(october.data.recordsTotal, 1);
  assert.equal(october.data.summary.totalFee, 20000);

  const dashboard = await call(
    'GET',
    `/api/dashboard?from=2026-10-01&to=2026-10-31&employeeId=${employee.id}`,
  );
  assert.equal(dashboard.data.summary.fuel, 20000);

  const report = await call(
    'GET',
    `/api/reports/print?from=2026-10-01&to=2026-10-31&type=daily&employeeId=${employee.id}`,
  );
  assert.equal(report.status, 200);
  assert.ok(sheetCells(report.data.sheets[0]).includes('20.000'));

  // Nhân viên nghỉ việc: Admin vẫn sửa được kỳ xăng cũ, giữ nguyên người phụ trách.
  await deactivate(employee);
  const edited = await call('PATCH', `/api/fuel/records/${record.data.id}`, {
    body: fuelBody({
      employeeId: employee.id,
      periodFrom: '2026-09-28',
      periodTo: '2026-10-03',
      fuelPrice: 22000,
    }),
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.totalFee, 22000);
});
