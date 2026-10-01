'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const XLSX = require('xlsx-js-style');
const { strFromU8, unzipSync } = require('fflate');
const { createApp } = require('../../server/index.cjs');
const {
  _test: { deliveryRows, dailyDetailRows, uniqueSheetName, validateExtraCostAssignments },
} = require('../../server/routes/reports.cjs');

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

test('gộp ghi chú trống theo từng ngày và tách riêng nhà xe có lý do', () => {
  const rows = deliveryRows([
    { entry_date: '2026-08-31', carrier: 'Nhà xe có lý do', rate_variance_note: 'Giá xăng tăng', duplicate_reason: '', bill_status: 'Không bill' },
    { entry_date: '2026-08-31', carrier: 'Nhà xe trống', rate_variance_note: '', duplicate_reason: '', bill_status: 'Có bill' },
    { entry_date: '2026-08-31', carrier: 'Nhà xe trống', rate_variance_note: '', duplicate_reason: '', bill_status: 'Có bill' },
    { entry_date: '2026-09-01', carrier: 'Nhà xe A', rate_variance_note: '', duplicate_reason: '', bill_status: 'Có bill' },
    { entry_date: '2026-09-01', carrier: 'Nhà xe B', rate_variance_note: '', duplicate_reason: '', bill_status: 'Không bill' },
  ]);

  assert.deepEqual(
    rows.map((row) => ({ noteValue: row.noteValue, noteSpan: row.noteSpan })),
    [
      { noteValue: 'Giá xăng tăng', noteSpan: 1 },
      { noteValue: '', noteSpan: 2 },
      { noteValue: undefined, noteSpan: undefined },
      { noteValue: '', noteSpan: 2 },
      { noteValue: undefined, noteSpan: undefined },
    ],
  );
});

test('năm nhà xe cùng bến chỉ tính một chặng xăng', () => {
  const terminal = 'Bến xe Miền Tây, 395 Kinh Dương Vương';
  const deliveries = deliveryRows(
    Array.from({ length: 5 }, (_, index) => ({
      entry_date: '2026-09-01',
      carrier: `Nhà xe ${index + 1}`,
      carrier_delivery_point: terminal,
      rate_variance_note: '',
      duplicate_reason: '',
      bill_status: 'Có bill',
    })),
  );

  const details = dailyDetailRows(deliveries, [{
    periodFrom: '2026-09-01',
    periodTo: '2026-09-01',
    distanceKm: 25,
    fuelPrice: 20_000,
    totalFee: 60_000,
    legs: [{ from: 'Kho', to: terminal, km: 25 }],
  }]);

  assert.equal(details.length, 5);
  assert.equal(details.filter((row) => row.fuelRow).length, 1);
  assert.equal(details.filter((row) => row.fuelLeg).length, 1);
  assert.equal(details[0].fuelLegSpan, 5);
  assert.equal(details[0].fuelSpan, 5);
  assert.deepEqual(details.map((row) => row.delivery.entry.carrier), [
    'Nhà xe 1', 'Nhà xe 2', 'Nhà xe 3', 'Nhà xe 4', 'Nhà xe 5',
  ]);
});

test('tên sheet báo cáo được làm sạch và không trùng nhau', () => {
  const used = new Set();
  assert.equal(uniqueSheetName('Nguyễn/Văn:*An?', used), 'Nguyễn Văn An');
  assert.equal(uniqueSheetName('nguyễn văn an', used), 'nguyễn văn an (2)');
  const longName = 'Nhân viên có tên rất dài vượt giới hạn Excel';
  const firstLongName = uniqueSheetName(longName, used);
  const secondLongName = uniqueSheetName(longName, used);
  assert.ok(firstLongName.length <= 31);
  assert.ok(secondLongName.length <= 31);
  assert.notEqual(firstLongName, secondLongName);
});

test('chi phí khác chỉ được cộng cho đúng nhân viên trên báo cáo', () => {
  const employees = [{ id: 10 }, { id: 20 }];
  assert.doesNotThrow(() => validateExtraCostAssignments(
    [{ name: 'Tiền ăn', amount: 50_000, employeeId: null }],
    [employees[0]],
    10,
  ));
  assert.throws(
    () => validateExtraCostAssignments(
      [{ name: 'Tiền ăn', amount: 50_000, employeeId: 20 }],
      [employees[0]],
      10,
    ),
    /không thuộc nhân viên đang xuất báo cáo/,
  );
  assert.throws(
    () => validateExtraCostAssignments(
      [{ name: 'Tiền ăn', amount: 50_000, employeeId: null }],
      employees,
      null,
    ),
    /chọn nhân viên chịu phí/,
  );
});

test('gợi ý lộ trình gồm khách hàng chưa lưu địa chỉ', async () => {
  const customer = await call('POST', '/api/customers', { customerName: 'Y Tế Ben Kin', address: '' });
  assert.equal(customer.status, 200);

  const listed = await call('GET', '/api/fuel');
  const location = listed.data.locations.find((item) => item.id === customer.data.id && item.type === 'customer');
  assert.deepEqual(location, {
    id: customer.data.id,
    name: 'Y Tế Ben Kin',
    address: '',
    type: 'customer',
    deliveryPoint: '',
  });
});

test('lưu, sửa và xóa kỳ tính xăng vẫn giữ tổng tiền và các chặng đường', async () => {
  const employee = await call('POST', '/api/employees', {
    fullName: 'Nhân viên tính xăng', address: '', userId: null, isActive: true,
  });
  assert.equal(employee.status, 200);
  const body = {
    periodFrom: '2026-09-01', periodTo: '2026-09-05', employeeId: employee.data.id,
    consumptionLiters: 12, consumptionBaseKm: 100, fuelPrice: 20_000,
    vehicleType: 'truck', fuelType: 'Xăng E10', region: 'region1', legs: [{ from: 'A', to: 'B', km: 30 }],
  };
  const created = await call('POST', '/api/fuel/records', body);
  assert.equal(created.status, 200);
  assert.equal(created.data.totalFee, 72_000);

  const listed = await call('GET', '/api/fuel');
  assert.equal(listed.data.recordsTotal, 1);
  assert.equal(listed.data.records[0].vehicleType, 'truck');
  assert.deepEqual(listed.data.records[0].legs, [{ from: 'A', to: 'B', km: 30 }]);

  const updated = await call('PATCH', `/api/fuel/records/${created.data.id}`, {
    ...body, legs: [{ from: 'A', to: 'B', km: 40 }, { from: 'B', to: 'C', km: 10 }],
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.totalFee, 120_000);

  const later = await call('POST', '/api/fuel/records', {
    ...body,
    periodFrom: '2026-09-10',
    periodTo: '2026-09-12',
    legs: [{ from: 'C', to: 'D', km: 20 }],
  });
  assert.equal(later.status, 200);

  const history = await call(
    'GET',
    '/api/reports/fuel-history?from=2026-09-01&to=2026-09-30&fuelType=X%C4%83ng%20E10',
  );
  assert.equal(history.status, 200);
  assert.equal(history.data.recordsTotal, 2);
  assert.deepEqual(history.data.summary, { distanceKm: 70, totalFee: 168_000 });
  assert.deepEqual(history.data.items.map((item) => item.id), [later.data.id, created.data.id]);
  assert.deepEqual(history.data.items[1], {
    id: created.data.id,
    periodFrom: '2026-09-01',
    periodTo: '2026-09-05',
    employeeName: 'Nhân viên tính xăng',
    distanceKm: 50,
    consumptionLiters: 12,
    consumptionBaseKm: 100,
    vehicleType: 'truck',
    fuelType: 'Xăng E10',
    region: 'region1',
    fuelPrice: 20_000,
    totalFee: 120_000,
    status: 'active',
    voidReason: '',
    legs: [
      { sequenceNo: 1, from: 'A', to: 'B', km: 40 },
      { sequenceNo: 2, from: 'B', to: 'C', km: 10 },
    ],
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
  const exportedBytes = Buffer.from(exported.data.contentBase64, 'base64');
  const workbook = XLSX.read(exportedBytes, { type: 'buffer', cellStyles: true });
  assert.deepEqual(workbook.SheetNames, ['Nhân viên tính xăng']);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  assert.equal(sheet.A1.v, 'BẢNG THỐNG KÊ TIỀN XĂNG');
  assert.equal(sheet.C8.v, 'Điểm đi');
  assert.equal(sheet.D8.v, 'Điểm đến');
  assert.equal(sheet.E8.v, 'Phương tiện');
  assert.equal(sheet.F8.v, 'Km');
  assert.deepEqual(sheet['!cols'].map((column) => column.wch), [8, 22, 36, 36, 15, 16, 16, 17]);
  assert.equal(sheet.A9.v, 1);
  assert.equal(sheet.B9.v, '01/09/2026 - 05/09/2026');
  assert.equal(sheet.C9.v, 'A');
  assert.equal(sheet.D9.v, 'B');
  assert.equal(sheet.E9.v, 'Ô tô');
  assert.equal(sheet.F9.v, 40);
  assert.equal(sheet.H9.v, 120_000);
  assert.equal(sheet.C10.v, 'B');
  assert.equal(sheet.D10.v, 'C');
  assert.equal(sheet.F10.v, 10);
  assert.equal(sheet.A11.v, 2);
  assert.equal(sheet.B11.v, '10/09/2026 - 12/09/2026');
  assert.equal(sheet.D13.v, 'Tổng quãng đường');
  assert.equal(sheet.E13.v, 70);
  assert.equal(sheet.D14.v, 'Tổng tiền xăng');
  assert.equal(sheet.E14.v, 168_000);
  assert.equal(sheet.C13, undefined);
  assert.equal(sheet['!merges'].some((item) => item.s.c === 2 && item.s.r === 12 && item.e.c === 3 && item.e.r === 12), false);
  assert.equal(sheet.G16.v, 'Ngày…..tháng…..năm….');
  const fuelArchive = unzipSync(exportedBytes);
  const fuelStylesXml = strFromU8(fuelArchive['xl/styles.xml']);
  const fuelSheetXml = strFromU8(fuelArchive['xl/worksheets/sheet1.xml']);
  assert.match(fuelStylesXml, /<i\/>/);
  assert.match(fuelSheetXml, /<c r="G16" s="\d+"/);
  assert.match(fuelSheetXml, /<pageSetUpPr fitToPage="1"\/>/);
  assert.match(fuelSheetXml, /<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35"/);
  assert.match(fuelSheetXml, /<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"\/>/);
  assert.doesNotMatch(fuelSheetXml, /<ignoredErrors\b/);
  assert.equal(sheet.A17.v, 'Giám Đốc');
  assert.equal(sheet.D17.v, 'Kế Toán Trưởng');
  assert.equal(sheet.E17, undefined);
  assert.equal(sheet['!merges'].some((item) => item.s.c === 3 && item.s.r === 16 && item.e.c === 4 && item.e.r === 16), false);
  assert.equal(sheet.G17.v, 'Người Lập');

  const dailyExport = await call(
    'GET',
    `/api/reports/export?from=2026-09-01&to=2026-09-30&employeeId=${employee.data.id}&type=daily`,
  );
  assert.equal(dailyExport.status, 200);
  const dailyWorkbook = XLSX.read(
    Buffer.from(dailyExport.data.contentBase64, 'base64'),
    { type: 'buffer', cellStyles: true },
  );
  assert.deepEqual(dailyWorkbook.SheetNames, ['Bảng kê cước']);
  const dailySheet = dailyWorkbook.Sheets['Bảng kê cước'];
  assert.equal(dailySheet.C11.v, 'Điểm đi');
  assert.equal(dailySheet.D11.v, 'Điểm đến');
  assert.equal(dailySheet.C12.v, 'A');
  assert.equal(dailySheet.D12.v, 'B');
  assert.equal(dailySheet.N12.v, 40);

  const deleted = await call('DELETE', `/api/fuel/records/${created.data.id}`);
  assert.deepEqual(deleted.data, { ok: true });
  const deletedLater = await call('DELETE', `/api/fuel/records/${later.data.id}`);
  assert.deepEqual(deletedLater.data, { ok: true });
});

test('xuất bảng kê cước gộp chi tiết xăng vào đúng bố cục báo cáo tổng hợp', async () => {
  const employee = await call('POST', '/api/employees', {
    fullName: 'Nhân viên báo cáo tổng hợp', address: '', userId: null, isActive: true,
  });
  assert.equal(employee.status, 200);

  const customer = await call('POST', '/api/customers', { customerName: 'Khách hàng tổng hợp' });
  assert.equal(customer.status, 200);
  const sharedDeliveryPoint = 'Bến xe dùng chung, Địa chỉ A';
  const carrier = await call('POST', '/api/carriers', {
    name: 'Nhà xe tổng hợp', deliveryPoint: sharedDeliveryPoint,
  });
  assert.equal(carrier.status, 200);
  const assigned = await call('PATCH', `/api/carriers/${carrier.data.id}/customers`, {
    customerIds: [customer.data.id],
  });
  assert.equal(assigned.status, 200);
  const rate = await call('POST', `/api/carriers/${carrier.data.id}/customers/${customer.data.id}/rates`, {
    isDefault: true, transportFee: 45_000, gateFee: 0, note: '',
  });
  assert.equal(rate.status, 200);
  const secondCarrier = await call('POST', '/api/carriers', {
    name: 'Nhà xe gộp bill', deliveryPoint: sharedDeliveryPoint,
  });
  assert.equal(secondCarrier.status, 200);
  const secondAssigned = await call('PATCH', `/api/carriers/${secondCarrier.data.id}/customers`, {
    customerIds: [customer.data.id],
  });
  assert.equal(secondAssigned.status, 200);
  const secondRate = await call('POST', `/api/carriers/${secondCarrier.data.id}/customers/${customer.data.id}/rates`, {
    isDefault: true, transportFee: 45_000, gateFee: 0, note: '',
  });
  assert.equal(secondRate.status, 200);

  const entry = await call('POST', '/api/entries', {
    entryDate: '2026-10-03',
    customerId: customer.data.id,
    customer: customer.data.customerName,
    carrier: carrier.data.name,
		recipient: 'Người nhận tổng hợp',
		address: 'Địa chỉ tổng hợp',
    spec: 'Thùng trung',
    transportFee: 50_000,
    gateFee: 10_000,
    ticketFee: 0,
    otherFeeName: 'Phí giao ngoài giờ',
    otherFee: 2_500,
    note: '300 TT + 100 Gene-HBVax',
    rateVarianceNote: 'Khách yêu cầu giao gấp',
    billStatus: 'Không bill',
    employeeId: employee.data.id,
  });
  assert.equal(entry.status, 200);

  for (const [recipient, product, duplicateReason, billStatus, otherFeeName, otherFee] of [
    ['Điểm giao thứ hai', '200 sản phẩm B', 'Cùng ngày có nhiều điểm giao', 'Có bill', 'Phí chờ bốc', 1_000],
    ['Điểm giao thứ ba', '300 sản phẩm C', 'Cùng ngày có nhiều điểm giao', 'Không bill', '', 0],
  ]) {
    const extraEntry = await call('POST', '/api/entries', {
      entryDate: '2026-10-03',
      customerId: customer.data.id,
      customer: customer.data.customerName,
      carrier: secondCarrier.data.name,
      recipient,
      address: 'Địa chỉ tổng hợp',
      spec: 'Thùng trung',
      transportFee: 45_000,
      gateFee: 0,
      ticketFee: 0,
      otherFeeName,
      otherFee,
      note: product,
      rateVarianceNote: '',
      duplicateReason,
      billStatus,
      employeeId: employee.data.id,
    });
    assert.equal(extraEntry.status, 200);
  }

  const variance = await call(
    'GET',
    `/api/reports/carrier-variance?from=2026-10-03&to=2026-10-03&employeeId=${employee.data.id}`,
  );
  assert.equal(variance.status, 200);
  assert.equal(variance.data.items.length, 1);
  assert.equal(variance.data.items[0].varianceNote, 'Khách yêu cầu giao gấp');

  const fuel = await call('POST', '/api/fuel/records', {
    periodFrom: '2026-10-03', periodTo: '2026-10-05', employeeId: employee.data.id,
    consumptionLiters: 12, consumptionBaseKm: 100, fuelPrice: 20_000,
    vehicleType: 'truck', fuelType: 'Xăng E10', region: 'region1', legs: [
      { from: 'Kho', to: sharedDeliveryPoint, km: 30 },
      { from: sharedDeliveryPoint, to: 'Điểm không phải nhà xe, Địa chỉ C', km: 10 },
    ],
    extraCosts: [
      { name: 'Gửi xe', amount: 7_000, legIndex: 0 },
      { name: 'Tiền ăn', amount: 3_000, legIndex: 1 },
    ],
  });
  assert.equal(fuel.status, 200);
  assert.equal(fuel.data.totalFee, 106_000);

  const exported = await call(
    'GET',
    `/api/reports/export?from=2026-10-03&to=2026-10-05&employeeId=${employee.data.id}&type=daily`,
  );
  assert.equal(exported.status, 200);

  const fuelDataAfterExport = await call('GET', `/api/fuel?employeeId=${employee.data.id}`);
  assert.equal(fuelDataAfterExport.status, 200);
  const fuelAfterExport = fuelDataAfterExport.data.records.find((item) => item.id === fuel.data.id);
  assert.equal(fuelAfterExport.finalizedAt, null);
  assert.equal(fuelAfterExport.canEdit, true);
  assert.equal(fuelAfterExport.canDelete, true);

  const exportedBytes = Buffer.from(exported.data.contentBase64, 'base64');
  const workbook = XLSX.read(exportedBytes, { type: 'buffer', cellStyles: true });
  const sheet = workbook.Sheets['Bảng kê cước'];
  assert.equal(sheet.A4.v, 'BẢNG CHI TIẾT CƯỚC NHÂN VIÊN');
  assert.deepEqual(workbook.SheetNames, ['Bảng kê cước']);
  assert.equal(sheet.C11.v, 'Điểm đi');
  assert.equal(sheet.D11.v, 'Điểm đến');
  assert.equal(sheet.E11.v, 'Nhà xe');
  assert.equal(sheet.F11.v, 'Khách hàng');
  assert.equal(sheet.H11.v, 'Sản phẩm');
  assert.equal(sheet.L11.v, 'Chênh lệch');
  assert.equal(sheet.M11.v, 'Bill');
  assert.equal(sheet.N11.v, 'Km');
  assert.equal(sheet.O11.v, 'Giá xăng');
  assert.equal(sheet.P11.v, 'Tiền xăng');
  assert.equal(sheet.Q11.v, 'Chi phí khác');
  assert.equal(sheet.R11.v, 'Ghi chú');
  assert.equal(sheet['!cols'].length, 18);
  assert.deepEqual(sheet['!cols'].map((column) => column.width), [
    5.42578125, 13.57, 27.7109375, 27.7109375, 14.42578125,
    32.5703125, 10.85546875, 28.42578125, 10.28515625, 10.140625,
    9.42578125, 11.85546875, 4.42578125, 7.42578125, 9.5703125,
    10.7109375, 11.7109375, 17.7109375,
  ]);
  assert.equal(sheet['!rows'][10].hpt, 34);
  for (const range of ['A1:D2', 'N1:R1', 'N2:R2', 'A4:R4', 'A7:R7']) {
    const expected = XLSX.utils.decode_range(range);
    assert.equal(
      sheet['!merges'].some(
        (item) => item.s.c === expected.s.c && item.s.r === expected.s.r
          && item.e.c === expected.e.c && item.e.r === expected.e.r,
      ),
      true,
    );
  }
  assert.equal(sheet.A12.v, 1);
  assert.equal(sheet.C12.v, 'Kho');
  assert.equal(sheet.D12.v, sharedDeliveryPoint);
  assert.equal(sheet.E12.v, 'Nhà xe tổng hợp');
  assert.equal(sheet.F12.v, 'Khách hàng tổng hợp');
  assert.equal(sheet.H12.v, '300 TT + 100 Gene-HBVax');
  assert.ok(sheet['!rows'][11].hpt >= 30);
  assert.equal(sheet.L12.v, 5_000);
  assert.equal(sheet.M12.v, '☐');
  const archive = unzipSync(exportedBytes);
  const stylesXml = strFromU8(archive['xl/styles.xml']);
  const sheetXml = strFromU8(archive['xl/worksheets/sheet1.xml']);
  assert.match(stylesXml, /FF0000/);
  assert.match(sheetXml, /<c r="L12" s="\d+"/);
  assert.match(sheetXml, /<pageSetUpPr fitToPage="1"\/>/);
  assert.match(sheetXml, /<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35"/);
  assert.match(sheetXml, /<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/);
  assert.doesNotMatch(sheetXml, /<ignoredErrors\b/);
  assert.equal(sheet.N12.v, 30);
  assert.equal(sheet.E13.v, 'Nhà xe gộp bill');
  assert.equal(sheet.H13.v, '200 sản phẩm B');
  assert.equal(sheet.H14.v, '300 sản phẩm C');
  assert.equal(sheet.O12.v, 20_000);
  assert.equal(sheet.P12.v, 96_000);
  assert.equal(sheet.Q12.v, 9_500);
  assert.equal(sheet.R12.v, 'Khách yêu cầu giao gấp / Phí giao ngoài giờ / Gửi xe');
  assert.equal(sheet.Q13.v, 1_000);
  assert.equal(sheet.R13.v, 'Cùng ngày có nhiều điểm giao / Phí chờ bốc');
  assert.doesNotMatch(sheet.R12.v, /bill/i);
  assert.doesNotMatch(sheet.R13.v, /bill/i);
  for (const column of [14, 15]) {
    assert.equal(
      sheet['!merges'].some(
        (item) => item.s.c === column && item.s.r === 11
          && item.e.c === column && item.e.r === 14,
      ),
      true,
    );
  }
  assert.equal(
      sheet['!merges'].some(
        (item) => item.s.c === 0 && item.s.r === 11
          && item.e.c === 0 && item.e.r === 14,
    ),
    true,
  );
  for (const column of [4]) {
    assert.equal(
      sheet['!merges'].some(
        (item) => item.s.c === column && item.s.r === 12
          && item.e.c === column && item.e.r === 13,
      ),
      true,
    );
  }
  assert.equal(
    sheet['!merges'].some(
      (item) => item.s.c === 16 && item.s.r === 12
        && item.e.c === 16 && item.e.r === 13,
    ),
    true,
  );
  assert.equal(
    sheet['!merges'].some(
      (item) => item.s.c === 17 && item.s.r === 12
        && item.e.c === 17 && item.e.r === 13,
    ),
    true,
  );
  assert.equal(sheet.M13.v, '☑');
  assert.equal(sheet.M14.v, '☐');
  assert.equal(
    sheet['!merges'].some(
      (item) => item.s.c === 12 && item.s.r === 12
        && item.e.c === 12 && item.e.r === 13,
    ),
    false,
  );
  assert.equal(sheet.R14.v, '-');
  assert.equal(sheet.P14.v, '');
  for (const column of [2, 3, 13]) {
    assert.equal(
      sheet['!merges'].some(
        (item) => item.s.c === column && item.s.r === 11
          && item.e.c === column && item.e.r === 13,
      ),
      true,
    );
  }
  assert.equal(sheet.C15.v, sharedDeliveryPoint);
  assert.equal(sheet.D15.v, 'Điểm không phải nhà xe, Địa chỉ C');
  for (const column of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
    assert.equal(sheet[`${column}15`].v, '-');
  }
  assert.equal(sheet.N15.v, 10);
  assert.equal(sheet.Q15.v, 3_000);
  assert.equal(sheet.R15.v, 'Tiền ăn');
  assert.equal(sheet.C17.v, 140_000);
  assert.equal(sheet.C18.v, 10_000);
  assert.equal(sheet.C19.v, 96_000);
  assert.equal(sheet.C20.v, 13_500);
  assert.equal(sheet.C21.v, 259_500);
  assert.equal(sheet.P23.v, 'Ngày… tháng…năm….');
  assert.equal(sheet.A24.v, 'Giám Đốc Duyệt');
  assert.equal(sheet.F24.v, 'Kế Toán Trưởng');
  assert.equal(sheet.P24.v, 'Người lập');
  for (const range of ['P23:R23', 'A24:C24', 'F24:I24', 'P24:R24']) {
    const expected = XLSX.utils.decode_range(range);
    assert.equal(
      sheet['!merges'].some(
        (item) => item.s.c === expected.s.c && item.s.r === expected.s.r
          && item.e.c === expected.e.c && item.e.r === expected.e.r,
      ),
      true,
    );
  }
  for (const row of [17, 18, 19, 20]) {
    assert.equal(sheet[`D${row}`], undefined);
    assert.equal(
      sheet['!merges'].some(
        (item) => item.s.c === 2 && item.s.r === row - 1
          && item.e.c === 3 && item.e.r === row - 1,
      ),
      false,
    );
  }
  assert.equal(archive['xl/featurePropertyBag/featurePropertyBag.xml'], undefined);
  assert.doesNotMatch(stylesXml, /xfpb:xfComplement i="0"/);
  assert.doesNotMatch(sheetXml, /<c r="L1[23]"[^>]*t="b">/);
  assert.doesNotMatch(sheetXml, /<c r="K14"[^>]*t="b">/);
});
