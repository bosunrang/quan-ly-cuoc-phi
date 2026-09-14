'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const XLSX = require('xlsx-js-style');
const { createApp } = require('../../server/index.cjs');

let app;
let baseUrl;
let token;
let workDir;

async function call(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'cuocphi-fuel-test-'));
  app = createApp({ dbFile: join(workDir, 'test.sqlite'), staticRoot: null });
  const address = await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: app.seeded.username, password: app.seeded.password }),
  });
  token = (await login.json()).token;
  await call('POST', '/api/me/initial-password', { newPassword: 'MatKhauAdmin123' });
});

after(async () => {
  await app?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test('lưu, sửa và xóa kỳ tính xăng vẫn giữ tổng tiền và các chặng đường', async () => {
  const employee = await call('POST', '/api/employees', {
    fullName: 'Nhân viên tính xăng', address: '', userId: null, isActive: true,
  });
  assert.equal(employee.status, 200);
  const body = {
    periodFrom: '2026-09-01', periodTo: '2026-09-05', employeeId: employee.data.id,
    consumptionLiters: 12, consumptionBaseKm: 100, fuelPrice: 20_000,
    fuelType: 'Xăng E10', region: 'region1', legs: [{ from: 'A', to: 'B', km: 30 }],
  };
  const created = await call('POST', '/api/fuel/records', body);
  assert.equal(created.status, 200);
  assert.equal(created.data.totalFee, 72_000);

  const listed = await call('GET', '/api/fuel');
  assert.equal(listed.data.recordsTotal, 1);
  assert.deepEqual(listed.data.records[0].legs, [{ from: 'A', to: 'B', km: 30 }]);

  const updated = await call('PATCH', `/api/fuel/records/${created.data.id}`, {
    ...body, legs: [{ from: 'A', to: 'B', km: 40 }],
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.totalFee, 96_000);

  const history = await call(
    'GET',
    '/api/reports/fuel-history?from=2026-09-01&to=2026-09-30&fuelType=X%C4%83ng%20E10',
  );
  assert.equal(history.status, 200);
  assert.equal(history.data.recordsTotal, 1);
  assert.deepEqual(history.data.items[0], {
    id: created.data.id,
    periodFrom: '2026-09-01',
    periodTo: '2026-09-05',
    employeeName: 'Nhân viên tính xăng',
    distanceKm: 40,
    consumptionLiters: 12,
    consumptionBaseKm: 100,
    fuelType: 'Xăng E10',
    region: 'region1',
    fuelPrice: 20_000,
    totalFee: 96_000,
    status: 'active',
    voidReason: '',
    legs: [{ sequenceNo: 1, from: 'A', to: 'B', km: 40 }],
  });

  const exported = await call(
    'GET',
    `/api/reports/fuel-history/export?from=2026-09-01&to=2026-09-30&fuelType=X%C4%83ng%20E10&employeeId=${employee.data.id}`,
  );
  assert.equal(exported.status, 200);
  assert.equal(
    exported.data.fileName,
    'Bảng thống kê tiền xăng - Nhân viên tính xăng - từ ngày 01-09-2026 đến 30-09-2026.xlsx',
  );
  const workbook = XLSX.read(Buffer.from(exported.data.contentBase64, 'base64'), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Nhân viên tính xăng']);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  assert.equal(sheet.A1.v, 'BẢNG THỐNG KÊ TIỀN XĂNG');
  assert.equal(sheet.C9.v, 'A → B');
  assert.equal(sheet.D9.v, '40 Km');
  assert.equal(sheet.F9.v, 96_000);

  const deleted = await call('DELETE', `/api/fuel/records/${created.data.id}`);
  assert.deepEqual(deleted.data, { ok: true, voided: false });
});
