'use strict';

/**
 * Kiểm thử nền móng. Chạy bằng test runner có sẵn của Node:
 *   node --test tests/
 *
 * Trọng tâm là ranh giới quyền: những thứ nếu hỏng thì nhân viên
 * nhìn thấy dữ liệu của nhau mà giao diện vẫn trông bình thường.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const XLSX = require('xlsx-js-style');

const { createApp } = require('../../server/index.cjs');
const { companyFromArgs, databaseFileName } = require('../../server/company-profiles.cjs');

let app;
let baseUrl;
let workDir;
let adminToken;
let staffAToken;
let staffBToken;
let staffAEmployeeId;

test('bốn hồ sơ công ty dùng đúng cổng và tệp dữ liệu riêng', () => {
  const namHungViet = companyFromArgs(['node', 'start.cjs', '--company=nam-hung-viet']);
  const naviva = companyFromArgs(['node', 'start.cjs', '--company=naviva-group']);
  const tuongKhue = companyFromArgs(['node', 'start.cjs', '--company=tuong-khue']);
  const winbio = companyFromArgs(['node', 'start.cjs', '--company=winbio']);

  assert.equal(namHungViet.port, 3100);
  assert.equal(naviva.port, 3101);
  assert.equal(tuongKhue.port, 3100);
  assert.equal(winbio.port, 3100);
  assert.equal(databaseFileName(namHungViet), 'cost-app.sqlite');
  assert.equal(databaseFileName(naviva), 'cost-app-naviva-group.sqlite');
  assert.equal(databaseFileName(tuongKhue), 'cost-app-tuong-khue.sqlite');
  assert.equal(databaseFileName(winbio), 'cost-app-winbio.sqlite');
});

/** Gọi API như một máy trạm thật: qua HTTP, kèm token. */
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
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
  };
}

async function login(username, password) {
  // Tài khoản Admin tạo phải tự đổi mật khẩu ở lần đầu; luồng đó có test riêng
  // trong hardening.test.cjs. Ở đây bỏ qua bước này để tập trung vào phân quyền.
  app.db.prepare('UPDATE users SET must_change_password = 0 WHERE username = ?').run(username);
  const result = await call('POST', '/api/login', {
    body: { username, password },
  });
  assert.equal(result.status, 200, `Đăng nhập ${username} thất bại`);
  return result.data.token;
}

function newEntry(overrides = {}) {
  return {
    entryDate: '2026-08-01',
    customer: 'Khách A',
    carrier: 'Nhà xe A',
    recipient: 'Người nhận A',
    address: 'Địa chỉ A',
    spec: 'Tất cả',
    ticketFee: 10000,
    transportFee: 200000,
    gateFee: 5000,
    otherFee: 0,
    note: 'Sản phẩm A',
    billStatus: 'Có bill',
    employeeId: staffAEmployeeId,
    ...overrides,
  };
}

async function configureStaffRate(customerName) {
  const customer = await call('POST', '/api/customers', {
    token: adminToken,
    body: { customerName },
  });
  assert.equal(customer.status, 200);
  const carrier = await call('POST', '/api/carriers', {
    token: adminToken,
    body: { name: `Nhà xe ${customerName}` },
  });
  assert.equal(carrier.status, 200);
  await call('PATCH', `/api/carriers/${carrier.data.id}/customers`, {
    token: adminToken,
    body: { customerIds: [customer.data.id] },
  });
  const rate = await call(
    'POST',
    `/api/carriers/${carrier.data.id}/customers/${customer.data.id}/rates`,
    {
      token: adminToken,
      body: { isDefault: true, transportFee: 200000, gateFee: 5000, note: '' },
    },
  );
  assert.equal(rate.status, 200);
  return { customer: customer.data, carrier: carrier.data };
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'cuocphi-test-'));
  app = createApp({ dbFile: join(workDir, 'test.sqlite'), staticRoot: null });
  const address = await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${address.port}`;

  const firstLogin = await call('POST', '/api/login', {
    body: { username: app.seeded.username, password: app.seeded.password },
  });
  assert.equal(firstLogin.status, 200);
  assert.equal(app.seeded.username, 'admin');
  assert.equal(app.seeded.password, 'admin');
  assert.equal(firstLogin.data.user.mustChangePassword, true);
  adminToken = firstLogin.data.token;
  const blockedBeforePasswordChange = await call('GET', '/api/audit', { token: adminToken });
  assert.equal(blockedBeforePasswordChange.status, 403);
  const initialPassword = await call('POST', '/api/me/initial-password', {
    token: adminToken,
    body: { newPassword: 'MatKhauAdmin123' },
  });
  assert.equal(initialPassword.status, 200);

  // Hai nhân viên: A được cấp thẻ nhập cước, B không được cấp thẻ nào.
  await call('POST', '/api/users', {
    token: adminToken,
    body: {
      username: 'nhanviena',
      fullName: 'Nhân viên A',
      password: 'MatKhau123',
      pages: ['entries'],
    },
  });
  await call('POST', '/api/users', {
    token: adminToken,
    body: {
      username: 'nhanvienb',
      fullName: 'Nhân viên B',
      password: 'MatKhau123',
      pages: [],
    },
  });
  const users = await call('GET', '/api/users', { token: adminToken });
  const staffA = users.data.items.find((user) => user.username === 'nhanviena');
  // Nhân viên tự lập phiếu phải có bản ghi nhân viên liên kết tài khoản.
  const staffEmployee = await call('POST', '/api/employees', {
    token: adminToken,
    body: {
      fullName: 'Nhân viên A',
      address: '',
      userId: staffA.id,
      isActive: true,
    },
  });
  assert.equal(staffEmployee.status, 200);
  staffAEmployeeId = staffEmployee.data.id;
  staffAToken = await login('nhanviena', 'MatKhau123');
  staffBToken = await login('nhanvienb', 'MatKhau123');
});

after(async () => {
  await app?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('đăng nhập', () => {
  test('sai mật khẩu bị từ chối', async () => {
    const result = await call('POST', '/api/login', {
      body: { username: 'nhanviena', password: 'sai-mat-khau' },
    });
    assert.equal(result.status, 401);
  });

  test('không có token thì mọi API nghiệp vụ đều bị chặn', async () => {
    for (const path of ['/api/entries', '/api/users', '/api/audit', '/api/me']) {
      const result = await call('GET', path);
      assert.equal(result.status, 401, `${path} phải trả 401`);
    }
  });

  test('token bịa ra không dùng được', async () => {
    const result = await call('GET', '/api/me', { token: 'token-gia-mao' });
    assert.equal(result.status, 401);
  });

  test('màn đăng nhập đọc được nhận diện công khai', async () => {
    const result = await call('GET', '/api/settings');
    assert.equal(result.status, 200);
    assert.equal(typeof result.data.displayName, 'string');
    assert.equal('companyName' in result.data, true);
  });
});

describe('cài đặt dùng chung', () => {
  test('nhân viên đọc được nhận diện nhưng không sửa được', async () => {
    const read = await call('GET', '/api/settings', { token: staffAToken });
    assert.equal(read.status, 200);
    assert.equal(read.data.displayName, 'NAVIVA GROUP');
    assert.equal(read.data.logoDataUrl, '/icon.png');

    const update = await call('PATCH', '/api/settings', {
      token: staffAToken,
      body: { ...read.data, displayName: 'Đổi trái phép' },
    });
    assert.equal(update.status, 403);
  });

  test('Admin sửa được nhận diện dùng chung', async () => {
    const current = await call('GET', '/api/settings', { token: adminToken });
    const update = await call('PATCH', '/api/settings', {
      token: adminToken,
      body: {
        ...current.data,
        companyName: 'Công ty thử nghiệm',
        displayName: 'Cước phí nội bộ',
      },
    });
    assert.equal(update.status, 200);
    assert.equal(update.data.displayName, 'Cước phí nội bộ');

    const after = await call('GET', '/api/settings', { token: staffAToken });
    assert.equal(after.data.companyName, 'Công ty thử nghiệm');
    assert.equal(after.data.displayName, 'Cước phí nội bộ');
  });

  test('từ chối logo không đúng định dạng', async () => {
    const current = await call('GET', '/api/settings', { token: adminToken });
    const result = await call('PATCH', '/api/settings', {
      token: adminToken,
      body: { ...current.data, logoDataUrl: 'khong-phai-anh' },
    });
    assert.equal(result.status, 400);
  });

  test('Admin xuất và nhập lại được backup dữ liệu nghiệp vụ', async () => {
    const denied = await call('GET', '/api/settings/backup', { token: staffAToken });
    assert.equal(denied.status, 403);

    const exported = await call('GET', '/api/settings/backup', { token: adminToken });
    assert.equal(exported.status, 200);
    assert.equal(exported.data.format, 'cuocphi-backup');
    assert.equal(exported.data.version, 1);
    assert.ok(Array.isArray(exported.data.data.employees));

    const restored = await call('POST', '/api/settings/backup/restore', {
      token: adminToken,
      body: { backup: exported.data },
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.restored, true);
  });

  test('backup giữ ghi chú chênh lệch và ánh xạ người chốt/hủy không còn tồn tại', async () => {
    const at = new Date().toISOString();
    app.db
      .prepare(
        `INSERT INTO entries
        (entry_date, customer, carrier, recipient, address, spec, ticket_fee,
         transport_fee, gate_fee, note, rate_variance_note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '2026-01-01',
        'Khách backup',
        'Nhà xe backup',
        '',
        '',
        '',
        0,
        100000,
        0,
        '',
        'Lý do chênh lệch cần giữ lại',
        1,
        at,
        at,
      );
    app.db
      .prepare(
        `INSERT INTO fuel_records
        (entry_date, employee_id, distance_km, consumption_liters, consumption_base_km,
         fuel_type, region, fuel_price, total_fee, note, created_by, created_at,
         period_from, period_to, updated_at, finalized_at, finalized_by, voided_at,
         voided_by, void_reason, status)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '2026-01-01',
        10,
        3.5,
        40,
        'Xăng E10',
        'region1',
        20000,
        17500,
        '',
        1,
        at,
        '2026-01-01',
        '2026-01-01',
        at,
        at,
        1,
        at,
        1,
        'Hủy để kiểm tra backup',
        'voided',
      );

    const exported = await call('GET', '/api/settings/backup', { token: adminToken });
    const backedUpEntry = exported.data.data.entries.find((row) => row.customer === 'Khách backup');
    const backedUpFuel = exported.data.data.fuelRecords.find((row) => row.note === '');
    assert.equal(backedUpEntry.rate_variance_note, 'Lý do chênh lệch cần giữ lại');

    // Mô phỏng backup từ máy khác: các tài khoản đã chốt/hủy không tồn tại tại máy này.
    backedUpFuel.finalized_by = 999998;
    backedUpFuel.voided_by = 999999;
    const restored = await call('POST', '/api/settings/backup/restore', {
      token: adminToken,
      body: { backup: exported.data },
    });
    assert.equal(restored.status, 200);

    const entry = app.db
      .prepare("SELECT rate_variance_note FROM entries WHERE customer = 'Khách backup'")
      .get();
    const fuel = app.db
      .prepare(
        "SELECT finalized_by, voided_by FROM fuel_records WHERE void_reason = 'Hủy để kiểm tra backup'",
      )
      .get();
    assert.equal(entry.rate_variance_note, 'Lý do chênh lệch cần giữ lại');
    assert.equal(fuel.finalized_by, 1);
    assert.equal(fuel.voided_by, 1);

    app.db.prepare("DELETE FROM fuel_records WHERE void_reason = 'Hủy để kiểm tra backup'").run();
    app.db.prepare("DELETE FROM entries WHERE customer = 'Khách backup'").run();
  });
});

describe('nhập dữ liệu MISA', () => {
  const misaRow = (overrides = {}) => ({
    rowNumber: 4,
    documentDate: '2026-06-01',
    documentCode: 'BH001',
    customerCode: 'KH001',
    customerName: 'Bệnh viện A',
    address: '01 Nguyễn Huệ',
    productCode: 'SP001',
    productName: 'Mặt hàng A',
    quantitySold: 4,
    provinceCity: 'Hồ Chí Minh',
    sourceKey: '2026-06-01|bh001|kh001|benh vien a|01 nguyen hue|sp001|lo1|4',
    status: 'ready',
    reason: '',
    ...overrides,
  });

  test('nhân viên không được xem hay nhập dữ liệu MISA', async () => {
    const list = await call('GET', '/api/misa', { token: staffAToken });
    assert.equal(list.status, 403);
    const preview = await call('POST', '/api/misa/preview', {
      token: staffAToken,
      body: { fileName: 'misa.xlsx', rows: [misaRow()] },
    });
    assert.equal(preview.status, 403);
  });

  test('xem trước phân loại sẵn sàng, trùng trong file và bỏ qua', async () => {
    const result = await call('POST', '/api/misa/preview', {
      token: adminToken,
      body: {
        fileName: 'Dữ liệu Misa.xlsx',
        rows: [
          misaRow(),
          misaRow({ rowNumber: 5 }),
          misaRow({
            rowNumber: 6,
            documentDate: '',
            sourceKey: 'invalid:6',
            status: 'skipped',
            reason: 'Ngày chứng từ không hợp lệ',
          }),
        ],
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(
      {
        total: result.data.totalRows,
        ready: result.data.readyCount,
        duplicate: result.data.duplicateCount,
        skipped: result.data.skippedCount,
      },
      { total: 3, ready: 1, duplicate: 1, skipped: 1 },
    );
    assert.equal(result.data.rows[0].customerCode, 'KH001');
  });

  test('nhập dòng mới và lần sau nhận ra dòng đã tồn tại', async () => {
    const imported = await call('POST', '/api/misa/import', {
      token: adminToken,
      body: { fileName: 'Dữ liệu Misa.xlsx', rows: [misaRow()] },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.inserted, 1);

    const list = await call('GET', '/api/misa', { token: adminToken });
    assert.equal(list.status, 200);
    assert.equal(list.data.count, 1);
    assert.equal(list.data.totalQuantity, 4);
    assert.equal(list.data.items[0].customerCode, 'KH001');
    assert.equal(list.data.items[0].customerName, 'Bệnh viện A');
    assert.equal(list.data.items[0].productName, 'Mặt hàng A');

    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: { customerName: 'Bệnh viện A' },
    });
    assert.equal(customer.status, 200);
    const options = await call('GET', '/api/entries/form-options', {
      token: adminToken,
    });
    assert.equal(options.status, 200);
    assert.equal(
      options.data.customers.find((item) => item.id === customer.data.id).customerCode,
      'KH001',
    );

    const preview = await call('POST', '/api/misa/preview', {
      token: adminToken,
      body: { fileName: 'Dữ liệu Misa.xlsx', rows: [misaRow()] },
    });
    assert.equal(preview.data.readyCount, 0);
    assert.equal(preview.data.duplicateCount, 1);
  });

  test('nhập lại file cũ chỉ bổ sung tên mặt hàng, không nhân đôi dòng', async () => {
    const oldRow = misaRow();
    app.db
      .prepare('UPDATE misa_rows SET product_name = ? WHERE source_key = ?')
      .run('', oldRow.sourceKey);

    const preview = await call('POST', '/api/misa/preview', {
      token: adminToken,
      body: { fileName: 'Dữ liệu Misa.xlsx', rows: [oldRow] },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.readyCount, 1);
    assert.equal(preview.data.rows[0].reason, 'Bổ sung tên mặt hàng');

    const imported = await call('POST', '/api/misa/import', {
      token: adminToken,
      body: { fileName: 'Dữ liệu Misa.xlsx', rows: preview.data.rows },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.inserted, 1);

    const list = await call('GET', '/api/misa', { token: adminToken });
    assert.equal(list.data.count, 1);
    assert.equal(list.data.items[0].productName, 'Mặt hàng A');
  });

  test('nhập chồng khoảng ngày chặn đơn trùng dù tên khách, địa chỉ và số lô đổi', async () => {
    const first = misaRow({
      rowNumber: 20,
      documentDate: '2026-06-10',
      documentCode: 'BH010',
      customerCode: 'KH010',
      customerName: 'Bệnh viện A - tên lúc sáng',
      address: 'Địa chỉ lúc sáng',
      productCode: 'SP010',
      productName: 'Sản phẩm A',
      quantitySold: 12,
      sourceKey:
        '2026-06-10|bh010|kh010|benh vien a ten luc sang|dia chi luc sang|sp010|lo-sang|12',
    });
    const firstImport = await call('POST', '/api/misa/import', {
      token: adminToken,
      body: { fileName: 'MISA 1-5.xlsx', rows: [first] },
    });
    assert.equal(firstImport.data.inserted, 1);

    const exportedAgain = {
      ...first,
      rowNumber: 35,
      customerName: 'Bệnh viện A',
      address: 'Địa chỉ đã cập nhật',
      sourceKey: '2026-06-10|bh010|kh010|benh vien a|dia chi da cap nhat|sp010|lo-chieu|12',
    };
    const preview = await call('POST', '/api/misa/preview', {
      token: adminToken,
      body: { fileName: 'MISA 1-10.xlsx', rows: [exportedAgain] },
    });
    assert.equal(preview.data.readyCount, 0);
    assert.equal(preview.data.duplicateCount, 1);
    assert.match(preview.data.rows[0].reason, /mã khách hàng, đơn hàng, mã hàng/);

    const importedAgain = await call('POST', '/api/misa/import', {
      token: adminToken,
      body: { fileName: 'MISA 1-10.xlsx', rows: [exportedAgain] },
    });
    assert.equal(importedAgain.data.inserted, 0);
    assert.equal(importedAgain.data.duplicates, 1);
    const rows = app.db
      .prepare("SELECT COUNT(*) AS count FROM misa_rows WHERE document_code = 'BH010'")
      .get();
    assert.equal(rows.count, 1);
  });

  test('mã khách hàng MISA giữ liên kết nhà xe khi tên khách thay đổi', async () => {
    const customerCode = 'KH-MISA-LIEN-KET';
    const imported = await call('POST', '/api/misa/import', {
      token: adminToken,
      body: {
        fileName: 'MISA lien ket theo ma.xlsx',
        rows: [
          misaRow({
            rowNumber: 9,
            documentDate: '2026-06-08',
            customerCode,
            customerName: 'Bệnh viện tên cũ trên MISA',
            productName: 'Sản phẩm liên kết theo mã',
            quantitySold: 7,
            provinceCity: 'Cần Thơ',
            sourceKey: '2026-06-08|kh-misa-lien-ket|san-pham-lien-ket|7',
          }),
        ],
      },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.inserted, 1);

    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: {
        customerName: 'Bệnh viện đã đổi tên trong danh mục',
        customerCode,
      },
    });
    const carrier = await call('POST', '/api/carriers', {
      token: adminToken,
      body: { name: 'Nhà xe Mã Cố Định 2026' },
    });
    assert.equal(customer.status, 200);
    assert.equal(carrier.status, 200);

    const assigned = await call('PATCH', `/api/carriers/${carrier.data.id}/customers`, {
      token: adminToken,
      body: { customerIds: [customer.data.id] },
    });
    assert.equal(assigned.status, 200);

    const options = await call('GET', '/api/entries/form-options', { token: adminToken });
    const option = options.data.customers.find((item) => item.id === customer.data.id);
    assert.equal(option.customerCode, customerCode);
    assert.equal(option.provinceCity, 'Cần Thơ');

    const context = await call(
      'GET',
      `/api/entries/customer-context?customerId=${customer.data.id}`,
      { token: adminToken },
    );
    assert.equal(context.status, 200);
    assert.equal(context.data.carriers[0].name, carrier.data.name);

    const orders = await call(
      'GET',
      `/api/entries/misa-orders?customerId=${customer.data.id}&endDate=2026-06-10`,
      { token: adminToken },
    );
    assert.equal(orders.status, 200);
    assert.equal(orders.data.items.length, 1);
    assert.equal(orders.data.items[0].totalQuantity, 7);
    assert.match(orders.data.items[0].note, /Sản phẩm liên kết theo mã/);
  });

  test('tìm tiếng Việt không phân biệt dấu, hoa thường và Đ/đ', async () => {
    const row = misaRow({
      rowNumber: 8,
      documentCode: 'BH008',
      customerCode: 'KH008',
      customerName: 'Bệnh Viện Bệnh Nhiệt Đới',
      address: '764 Võ Văn Kiệt, Phường Chợ Quán',
      productCode: 'SP008',
      provinceCity: 'Hồ Chí Minh 1',
      sourceKey: '2026-06-01|bh008|kh008|benh vien benh nhiet doi|sp008|1',
    });
    const imported = await call('POST', '/api/misa/import', {
      token: adminToken,
      body: { fileName: 'Dữ liệu Misa.xlsx', rows: [row] },
    });
    assert.equal(imported.status, 200);

    for (const query of ['Nhiệt đới', 'nhiệt đới', 'NHIET DOI', 'nhiet doi']) {
      const result = await call('GET', `/api/misa?search=${encodeURIComponent(query)}`, {
        token: adminToken,
      });
      assert.equal(result.status, 200);
      assert.equal(result.data.count, 1, `Không tìm đúng với "${query}"`);
      assert.equal(result.data.items[0].customerName, row.customerName);
    }

    const byAddress = await call(
      'GET',
      `/api/misa?search=${encodeURIComponent('764 Võ Văn Kiệt')}`,
      { token: adminToken },
    );
    assert.equal(byAddress.status, 200);
    assert.equal(byAddress.data.count, 0, 'Ô tìm kiếm không được lọc theo địa chỉ');
  });

  test('danh sách MISA luôn trả đúng 50 dòng mỗi trang', async () => {
    const result = await call('GET', '/api/misa?pageSize=200', {
      token: adminToken,
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.pageSize, 50);
  });
});

describe('danh mục khách hàng', () => {
  test('xem trước nhập Excel lấy toàn bộ khóa khách hàng, không phân trang', async () => {
    const first = await call('POST', '/api/customers', {
      token: adminToken,
      body: { customerName: 'Khách hàng đã có A' },
    });
    const second = await call('POST', '/api/customers', {
      token: adminToken,
      body: { customerName: 'Khách hàng đã có B' },
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const keys = await call('GET', '/api/customers/import-keys', { token: adminToken });
    assert.equal(keys.status, 200);
    assert(keys.data.items.some((item) => item.nameKey === 'khach hang da co a'));
    assert(keys.data.items.some((item) => item.nameKey === 'khach hang da co b'));
  });

  test('nhập khách hàng không âm thầm cắt sau 1.000 dòng', async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      customerName: `Khách nhập số ${index + 1}`,
    }));
    const result = await call('POST', '/api/customers/import', {
      token: adminToken,
      body: { rows },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.inserted, 1_001);
    assert.equal(result.data.updated, 0);
    assert.equal(result.data.duplicates, 0);
  });

  test('mã khách hàng là duy nhất; import cập nhật tên nhưng giữ nhà xe và bảng cước', async () => {
    const customerCode = 'KH-DUY-NHAT-001';
    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: {
        customerName: 'Khách hàng tên cũ',
        customerCode,
        carrier: 'Nhà xe giữ nguyên khi import',
      },
    });
    assert.equal(customer.status, 200);
    const carriers = await call('GET', '/api/carriers', { token: adminToken });
    const carrier = carriers.data.items.find(
      (item) => item.name === 'Nhà xe giữ nguyên khi import',
    );
    assert.ok(carrier);
    const rate = await call(
      'POST',
      `/api/carriers/${carrier.id}/customers/${customer.data.id}/rates`,
      {
        token: adminToken,
        body: {
          isDefault: true,
          transportFee: 123000,
          gateFee: 4000,
          note: 'Bảng cước phải được giữ',
        },
      },
    );
    assert.equal(rate.status, 200);

    const imported = await call('POST', '/api/customers/import', {
      token: adminToken,
      body: {
        rows: [
          {
            customerName: 'Khách hàng đã đổi tên',
            customerCode: customerCode.toLowerCase(),
            carrier: '',
            address: '30 Đường mới',
          },
        ],
      },
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(imported.data, { inserted: 0, updated: 1, duplicates: 0 });

    const listed = await call('GET', `/api/customers?search=${customerCode}`, {
      token: adminToken,
    });
    assert.equal(listed.data.resultCount, 1);
    assert.equal(listed.data.items[0].id, customer.data.id);
    assert.equal(listed.data.items[0].customerName, 'Khách hàng đã đổi tên');
    assert.equal(listed.data.items[0].carrier, carrier.name);
    assert.equal(Object.hasOwn(listed.data.items[0], 'recipient'), false);

    const rates = await call(
      'GET',
      `/api/carriers/${carrier.id}/customers/${customer.data.id}/rates`,
      { token: adminToken },
    );
    assert.equal(rates.status, 200);
    assert.equal(rates.data.items.length, 1);
    assert.equal(rates.data.items[0].transportFee, 123000);

    const duplicateCode = await call('POST', '/api/customers', {
      token: adminToken,
      body: {
        customerName: 'Khách hàng khác nhưng trùng mã',
        customerCode: customerCode.toLowerCase(),
      },
    });
    assert.equal(duplicateCode.status, 400);
    assert.match(duplicateCode.data.error, /mã khách hàng.*đã được sử dụng/i);

    const uniqueIndex = app.db
      .prepare("PRAGMA index_list('customers')")
      .all()
      .find((index) => index.name === 'customers_customer_code_unique_idx');
    assert.equal(uniqueIndex?.unique, 1);

    const misaCustomerCodeLookupIndex = app.db
      .prepare("PRAGMA index_list('misa_rows')")
      .all()
      .find((index) => index.name === 'misa_customer_code_nocase_order_idx');
    assert.ok(misaCustomerCodeLookupIndex);
  });

  test('Admin thêm, tìm, sửa và xóa được khách hàng', async () => {
    const created = await call('POST', '/api/customers', {
      token: adminToken,
      body: {
        customerName: 'Công ty Đầu tư Ánh Dương',
        customerCode: 'KH-ANH-DUONG',
        carrier: 'Nhà xe Minh Phát',
        address: 'Quận 7, TP. Hồ Chí Minh',
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.customerName, 'Công ty Đầu tư Ánh Dương');
    assert.equal(created.data.customerCode, 'KH-ANH-DUONG');

    const found = await call('GET', '/api/customers?search=anh%20duong', {
      token: adminToken,
    });
    assert.equal(found.status, 200);
    assert.equal(found.data.items.length, 1);

    const foundByCode = await call('GET', '/api/customers?search=kh-anh-duong', {
      token: adminToken,
    });
    assert.equal(foundByCode.status, 200);
    assert.equal(foundByCode.data.items.length, 1);

    const updated = await call('PATCH', `/api/customers/${created.data.id}`, {
      token: adminToken,
      body: { ...created.data, address: 'Quận 1, TP. Hồ Chí Minh' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.address, 'Quận 1, TP. Hồ Chí Minh');
    assert.equal(Object.hasOwn(updated.data, 'recipient'), false);

    const duplicate = await call('POST', '/api/customers', {
      token: adminToken,
      body: { customerName: 'cong ty dau tu anh duong' },
    });
    assert.equal(duplicate.status, 400);

    const removed = await call('DELETE', `/api/customers/${created.data.id}`, {
      token: adminToken,
    });
    assert.equal(removed.status, 200);
  });

  test('nhà xe được gán hiển thị trong danh sách khách hàng', async () => {
    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: {
        customerName: 'Khách hàng liên kết nhà xe',
        customerCode: 'KH-LIEN-KET-NHA-XE',
      },
    });
    const carrier = await call('POST', '/api/carriers', {
      token: adminToken,
      body: { name: 'Nhà xe liên kết' },
    });
    assert.equal(customer.status, 200);
    assert.equal(carrier.status, 200);

    const assigned = await call('PATCH', `/api/carriers/${carrier.data.id}/customers`, {
      token: adminToken,
      body: { customerIds: [customer.data.id] },
    });
    assert.equal(assigned.status, 200);

    const assignedCustomers = await call('GET', `/api/carriers/${carrier.data.id}/customers`, {
      token: adminToken,
    });
    assert.equal(assignedCustomers.status, 200);
    assert.equal(assignedCustomers.data.items[0].customerCode, 'KH-LIEN-KET-NHA-XE');

    const listed = await call('GET', '/api/customers?search=nha%20xe%20lien%20ket', {
      token: adminToken,
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.items[0].carrier, 'Nhà xe liên kết');

    const unassigned = await call(
      'DELETE',
      `/api/carriers/${carrier.data.id}/customers/${customer.data.id}`,
      { token: adminToken },
    );
    assert.equal(unassigned.status, 200);

    const afterUnassign = await call('GET', '/api/customers?search=khach%20hang%20lien%20ket', {
      token: adminToken,
    });
    assert.equal(afterUnassign.status, 200);
    assert.equal(afterUnassign.data.items[0].carrier, '');
  });

  test('sửa nhà xe ở khách hàng đồng bộ liên kết hai chiều', async () => {
    const removedCarrier = await call('POST', '/api/carriers', {
      token: adminToken,
      body: { name: 'Nhà xe sẽ bỏ' },
    });
    const keptCarrier = await call('POST', '/api/carriers', {
      token: adminToken,
      body: { name: 'Nhà xe giữ lại' },
    });
    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: {
        customerName: 'Khách hàng đồng bộ nhà xe',
        carrier: 'Nhà xe sẽ bỏ, Nhà xe giữ lại',
      },
    });
    assert.equal(customer.status, 200);

    const updated = await call('PATCH', `/api/customers/${customer.data.id}`, {
      token: adminToken,
      body: { ...customer.data, carrier: 'Nhà xe giữ lại' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.carrier, 'Nhà xe giữ lại');

    const carriers = await call('GET', '/api/carriers', { token: adminToken });
    const removed = carriers.data.items.find((item) => item.id === removedCarrier.data.id);
    const kept = carriers.data.items.find((item) => item.id === keptCarrier.data.id);
    assert.equal(removed.assignedCustomerIds.includes(customer.data.id), false);
    assert.equal(kept.assignedCustomerIds.includes(customer.data.id), true);

    const deletion = await call('DELETE', `/api/carriers/${removedCarrier.data.id}`, {
      token: adminToken,
    });
    assert.equal(deletion.status, 200);
  });
});

describe('bảng cước theo nhà xe và khách hàng', () => {
  test('nhập và xuất Excel đồng bộ nhà xe, khách hàng và mức cước', async () => {
    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: { customerName: 'Khách hàng Excel bảng cước' },
    });
    assert.equal(customer.status, 200);
    const body = {
      carriers: [
        {
          rowNumber: 2,
          name: 'Nhà xe Excel',
          contact: '',
          phone: '0909000000',
          address: '10 Đường Excel',
          deliveryPoint: 'Bến xe Excel, 1 Đường chung',
          schedule: '17h',
          note: '',
          isActive: true,
        },
      ],
      rates: [
        {
          rowNumber: 2,
          carrierName: 'Nhà xe Excel',
          customerName: 'Khách hàng Excel bảng cước',
          spec: '01 thùng nhỏ',
          transportFee: 50000,
          gateFee: 15000,
          note: 'Ra nhận',
        },
      ],
    };
    const preview = await call('POST', '/api/carriers/excel/preview', {
      token: adminToken,
      body,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.rateSummary.ready, 1);

    const imported = await call('POST', '/api/carriers/excel/import', {
      token: adminToken,
      body,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.ratesCreated, 1);

    const duplicatePreview = await call('POST', '/api/carriers/excel/preview', {
      token: adminToken,
      body,
    });
    assert.equal(duplicatePreview.status, 200);
    assert.equal(duplicatePreview.data.carrierSummary.duplicate, 1);
    assert.equal(duplicatePreview.data.rateSummary.duplicate, 1);

    const reimported = await call('POST', '/api/carriers/excel/import', {
      token: adminToken,
      body,
    });
    assert.equal(reimported.status, 200);
    assert.equal(reimported.data.carriersCreated, 0);
    assert.equal(reimported.data.ratesCreated, 0);

    const exported = await call('GET', '/api/carriers/excel-export', {
      token: adminToken,
    });
    assert.equal(exported.status, 200);
    assert.equal(
      exported.data.carriers.some(
        (row) => row.name === 'Nhà xe Excel' && row.deliveryPoint === 'Bến xe Excel, 1 Đường chung',
      ),
      true,
    );
    assert.equal(
      exported.data.rates.some(
        (row) =>
          row.carrierName === 'Nhà xe Excel' &&
          row.customerName === 'Khách hàng Excel bảng cước' &&
          row.transportFee === 50000,
      ),
      true,
    );
  });

  test('import nhà xe cập nhật điểm giao hoặc bến xe cho nhà xe đã có', async () => {
    const carrier = await call('POST', '/api/carriers', {
      token: adminToken,
      body: {
        name: 'Nhà xe cập nhật bến',
        phone: '0909111222',
        deliveryPoint: '',
      },
    });
    assert.equal(carrier.status, 200);

    const body = {
      carriers: [
        {
          rowNumber: 2,
          name: 'Nhà xe cập nhật bến',
          contact: '',
          phone: '0909111222',
          address: '',
          deliveryPoint: 'Bến xe Trung tâm, 25 Đường A',
          schedule: '',
          note: '',
          isActive: true,
        },
      ],
      rates: [],
    };
    const preview = await call('POST', '/api/carriers/excel/preview', {
      token: adminToken,
      body,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.carrierSummary.update, 1);
    assert.equal(preview.data.carriers[0].status, 'update');

    const imported = await call('POST', '/api/carriers/excel/import', {
      token: adminToken,
      body,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.carriersCreated, 0);
    assert.equal(imported.data.carriersUpdated, 1);

    const carriers = await call('GET', '/api/carriers', { token: adminToken });
    const updated = carriers.data.items.find((item) => item.id === carrier.data.id);
    assert.equal(updated.deliveryPoint, 'Bến xe Trung tâm, 25 Đường A');
  });

  test('import bảng cước gán khách hàng theo mã dù tên khách hàng đã thay đổi', async () => {
    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: {
        customerName: 'Khách hàng mã bảng cước',
        customerCode: 'KH-BANG-CUOC-001',
      },
    });
    assert.equal(customer.status, 200);

    const body = {
      carriers: [],
      rates: [
        {
          rowNumber: 2,
          carrierName: 'Nhà xe gán theo mã',
          customerCode: 'kh-bang-cuoc-001',
          customerName: 'Khách hàng mã bảng cước',
          spec: 'Thùng nhỏ',
          transportFee: 45_000,
          gateFee: 0,
          note: '',
        },
      ],
    };
    const preview = await call('POST', '/api/carriers/excel/preview', {
      token: adminToken,
      body,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.rateSummary.ready, 1);

    const imported = await call('POST', '/api/carriers/excel/import', {
      token: adminToken,
      body,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.ratesCreated, 1);

    const renamedCustomer = await call('POST', '/api/carriers/excel/preview', {
      token: adminToken,
      body: {
        carriers: [],
        rates: [
          {
            ...body.rates[0],
            customerName: 'Tên khách hàng đã đổi trên file cước',
            spec: 'Thùng trung',
          },
        ],
      },
    });
    assert.equal(renamedCustomer.status, 200);
    assert.equal(renamedCustomer.data.rateSummary.ready, 1);
    assert.equal(renamedCustomer.data.rates[0].customerId, customer.data.id);
  });

  test('mỗi khách hàng được gán có nhiều quy cách, gồm cả mức mặc định', async () => {
    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: { customerName: 'Khách hàng bảng cước' },
    });
    const carrier = await call('POST', '/api/carriers', {
      token: adminToken,
      body: { name: 'Nhà xe bảng cước' },
    });
    await call('PATCH', `/api/carriers/${carrier.data.id}/customers`, {
      token: adminToken,
      body: { customerIds: [customer.data.id] },
    });

    const path = `/api/carriers/${carrier.data.id}/customers/${customer.data.id}/rates`;
    const defaultRate = await call('POST', path, {
      token: adminToken,
      body: { isDefault: true, transportFee: 40000, gateFee: 15000, note: 'Ra nhận' },
    });
    assert.equal(defaultRate.status, 200);
    assert.equal(defaultRate.data.spec, 'Tất cả');

    const smallBox = await call('POST', path, {
      token: adminToken,
      body: {
        spec: '01 thùng nhỏ',
        isDefault: false,
        transportFee: 50000,
        gateFee: 15000,
        note: '',
      },
    });
    assert.equal(smallBox.status, 200);

    const listed = await call('GET', path, { token: adminToken });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.items.length, 2);

    const duplicate = await call('POST', path, {
      token: adminToken,
      body: { spec: '01 THÙNG NHỎ', isDefault: false, transportFee: 50000, gateFee: 0, note: '' },
    });
    assert.equal(duplicate.status, 400);

    const staffCannotSaveRate = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: 'Thùng trung',
        transportFee: 60000,
        gateFee: 17000,
        saveCarrierRate: true,
      }),
    });
    assert.equal(staffCannotSaveRate.status, 400);
    assert.match(staffCannotSaveRate.data.error, /Chỉ quản trị viên/);

    const staffCannotUseUnconfiguredSpec = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: 'Thùng trung',
        transportFee: 60000,
        gateFee: 17000,
      }),
    });
    assert.equal(staffCannotUseUnconfiguredSpec.status, 400);
    assert.match(staffCannotUseUnconfiguredSpec.data.error, /Quy cách chưa được quản trị viên/);

    const staffConfiguredEntry = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: '01 thùng nhỏ',
        transportFee: 50000,
        gateFee: 15000,
      }),
    });
    assert.equal(staffConfiguredEntry.status, 200);
    await call('DELETE', `/api/entries/${staffConfiguredEntry.data.id}`, {
      token: adminToken,
    });

    const savedFromEntry = await call('POST', '/api/entries', {
      token: adminToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: 'Thùng trung',
        transportFee: 60000,
        gateFee: 17000,
        saveCarrierRate: true,
      }),
    });
    assert.equal(savedFromEntry.status, 200);

    const ratesAfterSave = await call('GET', path, { token: adminToken });
    assert.equal(
      ratesAfterSave.data.items.some(
        (item) =>
          item.spec === 'Thùng trung' && item.transportFee === 60000 && item.gateFee === 17000,
      ),
      true,
    );

    const updatedFromEntry = await call('POST', '/api/entries', {
      token: adminToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: 'Thùng trung',
        transportFee: 61000,
        gateFee: 18000,
        saveCarrierRate: true,
      }),
    });
    assert.equal(updatedFromEntry.status, 200);
    const ratesAfterUpdate = await call('GET', path, { token: adminToken });
    assert.equal(
      ratesAfterUpdate.data.items.filter((item) => item.spec === 'Thùng trung').length,
      1,
    );
    assert.equal(
      ratesAfterUpdate.data.items.find((item) => item.spec === 'Thùng trung').transportFee,
      61000,
    );

    const missingVarianceReason = await call('POST', '/api/entries', {
      token: adminToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: '01 thùng nhỏ',
        transportFee: 50001,
        gateFee: 15000,
      }),
    });
    assert.equal(missingVarianceReason.status, 400);
    assert.match(missingVarianceReason.data.error, /lý do chênh lệch cước/);

    const belowRateWithoutReason = await call('POST', '/api/entries', {
      token: adminToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: '01 thùng nhỏ',
        transportFee: 49999,
        gateFee: 15000,
      }),
    });
    assert.equal(belowRateWithoutReason.status, 200);
    assert.equal(belowRateWithoutReason.data.rateVarianceNote, '');

    const offRate = await call('POST', '/api/entries', {
      token: adminToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: '01 thùng nhỏ',
        transportFee: 50001,
        gateFee: 15000,
        rateVarianceNote: 'Điều chỉnh giá giao thực tế',
      }),
    });
    assert.equal(offRate.status, 200);

    const entryList = await call('GET', '/api/entries', { token: adminToken });
    const listedOverRate = entryList.data.items.find((item) => item.id === offRate.data.id);
    assert.equal(listedOverRate.standardTransportFee, 50000);

    const variance = await call(
      'GET',
      '/api/reports/carrier-variance?from=2026-08-01&to=2026-08-01',
      { token: adminToken },
    );
    assert.equal(variance.status, 200);
    assert.equal(
      variance.data.items.some(
        (item) =>
          item.customer === customer.data.customerName &&
          item.carrier === carrier.data.name &&
          item.entryDate === '2026-08-01' &&
          item.employeeName === 'Nhân viên A' &&
          item.difference === 1 &&
          item.varianceNote.includes('Điều chỉnh giá giao thực tế'),
      ),
      true,
    );

    const varianceExport = await call(
      'GET',
      '/api/reports/carrier-variance/export?from=2026-08-01&to=2026-08-01',
      { token: adminToken },
    );
    assert.equal(varianceExport.status, 200);
    assert.match(varianceExport.data.fileName, /Báo cáo chênh lệch cước nhà xe/);
    const workbook = XLSX.read(Buffer.from(varianceExport.data.contentBase64, 'base64'), {
      type: 'buffer',
    });
    const worksheet = workbook.Sheets['Chênh lệch cước'];
    assert.equal(worksheet.C4.v, 'Nhân viên');
    assert.equal(worksheet.C5.v, 'Nhân viên A');

    const atStandard = await call('POST', '/api/entries', {
      token: adminToken,
      body: newEntry({
        customerId: customer.data.id,
        customer: customer.data.customerName,
        carrier: carrier.data.name,
        spec: '01 thùng nhỏ',
        transportFee: 50000,
        gateFee: 15000,
      }),
    });
    assert.equal(atStandard.status, 200);

    const cleanup = await call('DELETE', `/api/entries/${atStandard.data.id}`, {
      token: adminToken,
    });
    assert.equal(cleanup.status, 200);
    const cleanupOffRate = await call('DELETE', `/api/entries/${offRate.data.id}`, {
      token: adminToken,
    });
    assert.equal(cleanupOffRate.status, 200);

    const updated = await call('PATCH', `${path}/${smallBox.data.id}`, {
      token: adminToken,
      body: {
        spec: '01 thùng nhỏ',
        isDefault: false,
        transportFee: 55000,
        gateFee: 15000,
        note: 'Mức mới',
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.transportFee, 55000);

    const removed = await call('DELETE', `${path}/${defaultRate.data.id}`, {
      token: adminToken,
    });
    assert.equal(removed.status, 200);
  });
});

describe('phân quyền thẻ', () => {
  test('Admin tạo được tài khoản toàn quyền cho người kiểm tra', async () => {
    const created = await call('POST', '/api/users', {
      token: adminToken,
      body: {
        username: 'sepkiemtra',
        fullName: 'Sếp kiểm tra',
        password: 'MatKhau123',
        isAdmin: true,
        pages: [],
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.isAdmin, true);
    assert.ok(created.data.pages.includes('users'));

    const bossToken = await login('sepkiemtra', 'MatKhau123');
    const users = await call('GET', '/api/users', { token: bossToken });
    assert.equal(users.status, 200);
  });

  test('nhân viên A vào được thẻ nhập cước', async () => {
    const result = await call('GET', '/api/entries', { token: staffAToken });
    assert.equal(result.status, 200);
  });

  test('nhân viên B chưa được cấp thẻ nào thì bị từ chối', async () => {
    const result = await call('GET', '/api/entries', { token: staffBToken });
    assert.equal(result.status, 403);
  });

  test('nhân viên không vào được màn hình quản trị', async () => {
    for (const path of ['/api/users', '/api/audit', '/api/pages']) {
      const result = await call('GET', path, { token: staffAToken });
      assert.equal(result.status, 403, `${path} phải trả 403 với nhân viên`);
    }
  });

  test('menu trả về đúng thẻ được cấp', async () => {
    const staff = await call('GET', '/api/me', { token: staffAToken });
    assert.deepEqual(
      staff.data.menu.map((m) => m.key),
      ['entries'],
    );

    const admin = await call('GET', '/api/me', { token: adminToken });
    assert.deepEqual(
      admin.data.menu.map((m) => m.key),
      [
        'dashboard',
        'entries',
        'misa',
        'employees',
        'customers',
        'carriers',
        'fuel',
        'reports_employee',
        'reports_carrier',
        'reports_fuel_price',
        'users',
        'audit',
        'settings',
      ],
    );
  });

  test('máy trạm được cấp báo cáo cước chỉ thấy và xuất dữ liệu của mình', async () => {
    const list = await call('GET', '/api/users', { token: adminToken });
    const staffA = list.data.items.find((user) => user.username === 'nhanviena');
    const anotherEmployee = await call('POST', '/api/employees', {
      token: adminToken,
      body: {
        fullName: 'Nhân viên khác',
        address: '',
        userId: null,
        isActive: true,
      },
    });
    assert.equal(anotherEmployee.status, 200);

    await call('PATCH', `/api/users/${staffA.id}`, {
      token: adminToken,
      body: { pages: ['entries', 'reports_employee'] },
    });

    const profile = await call('GET', '/api/me', { token: staffAToken });
    assert.ok(profile.data.pages.includes('reports_employee'));

    const catalog = await call('GET', '/api/reports', { token: staffAToken });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.canReportAll, false);
    assert.deepEqual(
      catalog.data.employees.map((employee) => employee.id),
      [staffAEmployeeId],
    );

    // Thay employeeId trên URL không được phép đổi sang báo cáo của người khác.
    const exported = await call(
      'GET',
      `/api/reports/export?from=2026-08-01&to=2026-08-01&type=daily&employeeId=${anotherEmployee.data.id}`,
      { token: staffAToken },
    );
    assert.equal(exported.status, 200);
    assert.match(exported.data.fileName, /Nhân viên A/);

    const printable = await call(
      'GET',
      `/api/reports/print?from=2026-08-01&to=2026-08-01&type=daily&employeeId=${anotherEmployee.data.id}`,
      { token: staffAToken },
    );
    assert.equal(printable.status, 200);
    assert.equal(printable.data.sheets.length, 1);
    const printCells = printable.data.sheets[0].rows.flatMap((row) => row.cells);
    assert.ok(printCells.some((cell) => cell.value.includes('Nhân viên A')));
    assert.equal(
      printCells.some((cell) => cell.value.includes('Nhân viên khác')),
      false,
    );
  });

  test('không thể tự cấp cho mình thẻ chỉ dành cho Admin', async () => {
    const list = await call('GET', '/api/users', { token: adminToken });
    const staffA = list.data.items.find((u) => u.username === 'nhanviena');

    // Admin cố cấp thẻ "users" cho nhân viên — server phải lọc bỏ.
    await call('PATCH', `/api/users/${staffA.id}`, {
      token: adminToken,
      body: { pages: ['entries', 'users', 'audit'] },
    });

    const after = await call('GET', '/api/me', { token: staffAToken });
    assert.deepEqual(after.data.pages, ['entries']);

    const denied = await call('GET', '/api/users', { token: staffAToken });
    assert.equal(denied.status, 403);
  });
});

describe('nhân viên thấy phiếu được giao nhưng chỉ quản lý phiếu tự tạo', () => {
  test('nhân viên thấy cả phiếu tự nhập và phiếu Admin nhập giúp', async () => {
    const staffDelivery = await configureStaffRate('Khách của A');
    await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({
        customer: staffDelivery.customer.customerName,
        carrier: staffDelivery.carrier.name,
        spec: 'Tất cả',
      }),
    });
    await call('POST', '/api/entries', {
      token: adminToken,
      body: newEntry({ customer: 'Khách của Admin' }),
    });

    const staffView = await call('GET', '/api/entries', { token: staffAToken });
    assert.equal(staffView.data.scope, 'own');
    assert.ok(staffView.data.items.length >= 2);
    const ownEntry = staffView.data.items.find((item) => item.customer === 'Khách của A');
    const assignedEntry = staffView.data.items.find((item) => item.customer === 'Khách của Admin');
    assert.equal(ownEntry.canEdit, true);
    assert.equal(ownEntry.canDelete, true);
    assert.equal(assignedEntry.canEdit, false);
    assert.equal(assignedEntry.canDelete, false);

    const adminView = await call('GET', '/api/entries', { token: adminToken });
    assert.equal(adminView.data.scope, 'all');
    assert.equal(
      adminView.data.items.some((item) => item.customer === 'Khách của A'),
      true,
    );
    assert.equal(
      adminView.data.items.some((item) => item.customer === 'Khách của Admin'),
      true,
    );
    assert.ok(adminView.data.items.every((item) => item.canEdit && item.canDelete));
  });

  test('người tạo lấy từ phiên đăng nhập, không lấy từ dữ liệu gửi lên', async () => {
    const admin = await call('GET', '/api/me', { token: adminToken });
    const staffDelivery = await configureStaffRate('Giả mạo');
    // Nhân viên A cố khai phiếu này là của Admin.
    const created = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({
        customer: staffDelivery.customer.customerName,
        carrier: staffDelivery.carrier.name,
        spec: 'Tất cả',
        createdBy: admin.data.user.id,
      }),
    });
    assert.equal(created.status, 200);

    const staffA = await call('GET', '/api/me', { token: staffAToken });
    assert.equal(
      created.data.createdBy,
      staffA.data.user.id,
      'Phiếu phải thuộc về người đang đăng nhập',
    );
  });

  test('không sửa hay xóa được phiếu của người khác', async () => {
    const adminEntries = await call('GET', '/api/entries', { token: adminToken });
    const adminOwn = adminEntries.data.items.find((e) => e.customer === 'Khách của Admin');

    const updated = await call('PATCH', `/api/entries/${adminOwn.id}`, {
      token: staffAToken,
      body: newEntry({ customer: 'Bị sửa trộm' }),
    });
    assert.equal(updated.status, 404);

    const deleted = await call('DELETE', `/api/entries/${adminOwn.id}`, {
      token: staffAToken,
    });
    assert.equal(deleted.status, 404);

    // Phiếu vẫn còn nguyên.
    const check = await call('GET', '/api/entries', { token: adminToken });
    assert.ok(check.data.items.some((e) => e.customer === 'Khách của Admin'));
  });

  test('nhân viên không lọc được sang dữ liệu người khác qua tham số URL', async () => {
    const admin = await call('GET', '/api/me', { token: adminToken });
    const result = await call('GET', `/api/entries?createdBy=${admin.data.user.id}`, {
      token: staffAToken,
    });
    // Bộ lọc nhân viên phụ trách ở server phải thắng tham số gửi lên.
    assert.equal(result.data.scope, 'own');
    assert.ok(
      result.data.items.every((entry) => entry.employeeId === staffAEmployeeId),
      'Không được lọt phiếu giao cho nhân viên khác',
    );
    assert.ok(result.data.items.some((entry) => entry.customer === 'Khách của Admin'));
  });

  test('tổng tiền tự cộng và chỉ tính trên phạm vi được xem', async () => {
    const staffView = await call('GET', '/api/entries', { token: staffAToken });
    assert.equal(staffView.data.items[0].totalFee, 215000);
    assert.equal(
      staffView.data.total,
      staffView.data.items.reduce((sum, e) => sum + e.totalFee, 0),
    );
  });
});

describe('kiểm tra dữ liệu đầu vào', () => {
  test('lưu và sửa chi phí khác trong tổng tiền phiếu', async () => {
    const delivery = await configureStaffRate('Đơn vị có chi phí phát sinh');
    const created = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({
        entryDate: '2026-09-30',
        customer: delivery.customer.customerName,
        carrier: delivery.carrier.name,
        spec: 'Tất cả',
        recipient: '',
        otherFeeName: 'Tiền bốc xếp',
        otherFee: 12_345,
      }),
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.otherFeeName, 'Tiền bốc xếp');
    assert.equal(created.data.otherFee, 12_345);
    assert.equal(created.data.totalFee, 227_345);

    const updated = await call('PATCH', `/api/entries/${created.data.id}`, {
      token: staffAToken,
      body: {
        ...newEntry({
          entryDate: '2026-09-30',
          customer: delivery.customer.customerName,
          carrier: delivery.carrier.name,
          spec: 'Tất cả',
        }),
        otherFeeName: 'Phí chờ hàng',
        otherFee: 2_000,
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.totalFee, 217_000);
  });

  test('nhân viên phải giải trình phiếu trùng ngày và khách hàng khi tạo hoặc sửa', async () => {
    const delivery = await configureStaffRate('Đơn vị kiểm tra trùng phiếu');
    const firstInput = newEntry({
      entryDate: '2026-07-29',
      customerId: delivery.customer.id,
      customer: delivery.customer.customerName,
      carrier: delivery.carrier.name,
      spec: 'Tất cả',
      note: '100 Mặt hàng kiểm tra trùng',
    });
    const first = await call('POST', '/api/entries', {
      token: staffAToken,
      body: firstInput,
    });
    assert.equal(first.status, 200);

    const immediateDuplicate = await call(
      'GET',
      `/api/entries/duplicate-check?entryDate=2026-07-29&customer=${encodeURIComponent(delivery.customer.customerName)}`,
      { token: staffAToken },
    );
    assert.equal(immediateDuplicate.status, 200);
    assert.equal(immediateDuplicate.data.duplicate, true);

    const duplicateWithoutReason = await call('POST', '/api/entries', {
      token: staffAToken,
      body: { ...firstInput, note: 'Một mặt hàng khác vẫn phải cảnh báo' },
    });
    assert.equal(duplicateWithoutReason.status, 409);
    assert.match(duplicateWithoutReason.data.error, /cùng ngày gửi và khách hàng/);

    const duplicateWithReason = await call('POST', '/api/entries', {
      token: staffAToken,
      body: { ...firstInput, duplicateReason: 'Giao hai chuyến riêng trong cùng ngày' },
    });
    assert.equal(duplicateWithReason.status, 200);
    assert.equal(duplicateWithReason.data.duplicateReason, 'Giao hai chuyến riêng trong cùng ngày');

    const anotherDay = await call('POST', '/api/entries', {
      token: staffAToken,
      body: { ...firstInput, entryDate: '2026-07-30' },
    });
    assert.equal(anotherDay.status, 200);

    const updateWithoutReason = await call('PATCH', `/api/entries/${anotherDay.data.id}`, {
      token: staffAToken,
      body: firstInput,
    });
    assert.equal(updateWithoutReason.status, 409);

    const updateWithReason = await call('PATCH', `/api/entries/${anotherDay.data.id}`, {
      token: staffAToken,
      body: { ...firstInput, duplicateReason: 'Điều chỉnh ngày cho chuyến giao thứ hai' },
    });
    assert.equal(updateWithReason.status, 200);
    assert.equal(updateWithReason.data.duplicateReason, 'Điều chỉnh ngày cho chuyến giao thứ hai');

    const missingProductInput = {
      ...firstInput,
      entryDate: '2026-07-28',
      note: '',
    };
    const missingProduct = await call('POST', '/api/entries', {
      token: staffAToken,
      body: missingProductInput,
    });
    assert.equal(missingProduct.status, 400);
    assert.match(missingProduct.data.error, /sản phẩm/);

    const adminDuplicate = await call('POST', '/api/entries', {
      token: adminToken,
      body: firstInput,
    });
    assert.equal(adminDuplicate.status, 200);
    assert.equal(adminDuplicate.data.duplicateReason, '');

    const adminCheck = await call(
      'GET',
      `/api/entries/duplicate-check?entryDate=2026-07-29&customer=${encodeURIComponent(delivery.customer.customerName)}`,
      { token: adminToken },
    );
    assert.equal(adminCheck.status, 200);
    assert.equal(adminCheck.data.duplicate, false);
  });

  test('từ chối ngày sai định dạng', async () => {
    const result = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({ entryDate: '01/08/2026' }),
    });
    assert.equal(result.status, 400);
  });

  test('từ chối ngày đúng định dạng nhưng không tồn tại', async () => {
    const entry = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({ entryDate: '2026-02-30' }),
    });
    const report = await call(
      'GET',
      '/api/reports/carrier-variance?from=2026-02-30&to=2026-03-01',
      {
        token: adminToken,
      },
    );
    assert.equal(entry.status, 400);
    assert.equal(report.status, 400);
  });

  test('từ chối số tiền âm', async () => {
    const result = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({ transportFee: -1000 }),
    });
    assert.equal(result.status, 400);
  });

  test('từ chối thiếu tên khách hàng', async () => {
    const result = await call('POST', '/api/entries', {
      token: staffAToken,
      body: newEntry({ customer: '   ' }),
    });
    assert.equal(result.status, 400);
  });

  test('từ chối mật khẩu quá ngắn khi tạo người dùng', async () => {
    const result = await call('POST', '/api/users', {
      token: adminToken,
      body: { username: 'nguoimoi', fullName: 'Người mới', password: '123' },
    });
    assert.equal(result.status, 400);
  });

  test('từ chối tên đăng nhập trùng', async () => {
    const result = await call('POST', '/api/users', {
      token: adminToken,
      body: {
        username: 'nhanviena',
        fullName: 'Trùng tên',
        password: 'MatKhau123',
      },
    });
    assert.equal(result.status, 400);
  });
});

describe('khóa tài khoản và đổi mật khẩu', () => {
  test('chỉ xóa được tài khoản nhân viên chưa có dữ liệu', async () => {
    const created = await call('POST', '/api/users', {
      token: adminToken,
      body: {
        username: 'taikhoanxoatest',
        fullName: 'Tài khoản xóa test',
        password: 'MatKhau123',
        pages: [],
      },
    });
    assert.equal(created.status, 200);

    const removed = await call('DELETE', `/api/users/${created.data.id}`, { token: adminToken });
    assert.equal(removed.status, 200);

    const list = await call('GET', '/api/users', { token: adminToken });
    const staffA = list.data.items.find((user) => user.username === 'nhanviena');
    const hasData = await call('DELETE', `/api/users/${staffA.id}`, { token: adminToken });
    assert.equal(hasData.status, 400);

    const me = await call('GET', '/api/me', { token: adminToken });
    const admin = await call('DELETE', `/api/users/${me.data.user.id}`, { token: adminToken });
    assert.equal(admin.status, 400);
  });

  test('khóa tài khoản thì cắt phiên đang mở', async () => {
    const list = await call('GET', '/api/users', { token: adminToken });
    const staffB = list.data.items.find((u) => u.username === 'nhanvienb');

    await call('PATCH', `/api/users/${staffB.id}`, {
      token: adminToken,
      body: { isActive: false },
    });

    const result = await call('GET', '/api/me', { token: staffBToken });
    assert.equal(result.status, 401);
  });

  test('Admin không tự khóa được chính mình', async () => {
    const me = await call('GET', '/api/me', { token: adminToken });
    const result = await call('PATCH', `/api/users/${me.data.user.id}`, {
      token: adminToken,
      body: { isActive: false },
    });
    assert.equal(result.status, 400);
  });

  test('đổi mật khẩu xong thì token cũ hết hiệu lực', async () => {
    const token = await login('nhanviena', 'MatKhau123');
    const changed = await call('POST', '/api/me/password', {
      token,
      body: { currentPassword: 'MatKhau123', newPassword: 'MatKhauMoi456' },
    });
    assert.equal(changed.status, 200);

    const reused = await call('GET', '/api/me', { token });
    assert.equal(reused.status, 401);

    staffAToken = await login('nhanviena', 'MatKhauMoi456');
  });

  test('sai mật khẩu hiện tại thì không đổi được', async () => {
    const result = await call('POST', '/api/me/password', {
      token: staffAToken,
      body: { currentPassword: 'khong-dung', newPassword: 'MatKhauKhac789' },
    });
    assert.equal(result.status, 400);
  });
});

describe('nhật ký', () => {
  test('ghi lại thao tác kèm người thực hiện', async () => {
    const result = await call('GET', '/api/audit', { token: adminToken });
    assert.equal(result.status, 200);

    const actions = result.data.items.map((row) => row.action);
    for (const expected of ['login', 'entry.create', 'user.create']) {
      assert.ok(actions.includes(expected), `Thiếu nhật ký "${expected}"`);
    }

    const created = result.data.items.find((row) => row.action === 'entry.create');
    assert.ok(created.username, 'Nhật ký phải ghi ai là người thao tác');

    const searched = await call('GET', '/api/audit?q=tạo phiếu', {
      token: adminToken,
    });
    assert.equal(searched.status, 200);
    assert.ok(
      searched.data.items.some((row) => row.action === 'entry.create'),
      'Tìm bằng nhãn tiếng Việt phải trả về thao tác tương ứng',
    );
  });

  test('chỉ quản trị viên được dọn nhật ký và thao tác vẫn được ghi lại', async () => {
    const denied = await call('POST', '/api/audit/cleanup', {
      token: staffAToken,
      body: { beforeDate: '9999-01-01' },
    });
    assert.equal(denied.status, 403);

    const cleaned = await call('POST', '/api/audit/cleanup', {
      token: adminToken,
      body: { beforeDate: '9999-01-01' },
    });
    assert.equal(cleaned.status, 200);
    assert.ok(cleaned.data.deleted > 0);

    const result = await call('GET', '/api/audit', { token: adminToken });
    assert.equal(result.status, 200);
    assert.ok(result.data.items.some((row) => row.action === 'audit.cleanup'));
  });
});

describe('xóa dữ liệu theo nhóm', () => {
  test('khách hàng và nhà xe được xóa độc lập', async () => {
    const customer = await call('POST', '/api/customers', {
      token: adminToken,
      body: { customerName: 'Khách hàng kiểm thử dọn dữ liệu' },
    });
    const carrier = await call('POST', '/api/carriers', {
      token: adminToken,
      body: { name: 'Nhà xe kiểm thử dọn dữ liệu' },
    });
    assert.equal(customer.status, 200);
    assert.equal(carrier.status, 200);

    const removeCustomers = await call('POST', '/api/settings/data/delete', {
      token: adminToken,
      body: { groups: ['customers'] },
    });
    assert.equal(removeCustomers.status, 200);
    assert.deepEqual(removeCustomers.data.deleted, ['customers']);
    assert.equal(
      app.db.prepare('SELECT COUNT(*) AS count FROM carriers WHERE id = ?').get(carrier.data.id)
        .count,
      1,
    );

    const removeCarriers = await call('POST', '/api/settings/data/delete', {
      token: adminToken,
      body: { groups: ['carriers'] },
    });
    assert.equal(removeCarriers.status, 200);
    assert.deepEqual(removeCarriers.data.deleted, ['carriers']);
  });

  test('xóa MISA cũng làm mới thẻ tổng quan', async () => {
    const primeOverview = await call('GET', '/api/misa', { token: adminToken });
    assert.equal(primeOverview.status, 200);
    assert.ok(primeOverview.data.count > 0);

    const removed = await call('POST', '/api/settings/data/delete', {
      token: adminToken,
      body: { groups: ['misa'] },
    });
    assert.equal(removed.status, 200);

    const afterDelete = await call('GET', '/api/misa', { token: adminToken });
    assert.equal(afterDelete.status, 200);
    assert.deepEqual(
      {
        count: afterDelete.data.count,
        totalQuantity: afterDelete.data.totalQuantity,
        customerCount: afterDelete.data.customerCount,
        provinceCount: afterDelete.data.provinceCount,
        provinces: afterDelete.data.provinces,
        lastImport: afterDelete.data.lastImport,
      },
      {
        count: 0,
        totalQuantity: 0,
        customerCount: 0,
        provinceCount: 0,
        provinces: [],
        lastImport: null,
      },
    );
  });

  test('xóa nhóm nhân viên tháo liên kết lịch sử, còn xóa lẻ thì bị chặn', async () => {
    const linkedEmployee = app.db
      .prepare(
        'SELECT id FROM employees WHERE id IN (SELECT employee_id FROM entries WHERE employee_id IS NOT NULL) LIMIT 1',
      )
      .get();
    assert.ok(linkedEmployee);

    const individual = await call('DELETE', `/api/employees/${linkedEmployee.id}`, {
      token: adminToken,
    });
    assert.equal(individual.status, 400);

    const removed = await call('POST', '/api/settings/data/delete', {
      token: adminToken,
      body: { groups: ['employees'] },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.data.deleted, ['employees']);
    assert.ok(removed.data.detachedEmployeeLinks.entries > 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM employees').get().count, 0);
    assert.equal(
      app.db.prepare('SELECT COUNT(*) AS count FROM entries WHERE employee_id IS NOT NULL').get()
        .count,
      0,
    );
    assert.equal(
      app.db
        .prepare('SELECT COUNT(*) AS count FROM fuel_records WHERE employee_id IS NOT NULL')
        .get().count,
      0,
    );
  });
});

describe('khôi phục quản trị viên', () => {
  test('mã dùng một lần chỉ khôi phục được trên máy chính', async () => {
    const generated = await call('POST', '/api/settings/recovery-code', {
      token: adminToken,
    });
    assert.equal(generated.status, 200);
    assert.match(generated.data.code, /^NAVIVA-/);

    const recovered = await call('POST', '/api/recover-admin', {
      body: {
        username: 'admin',
        code: generated.data.code,
        password: 'MatKhauMoi987',
      },
    });
    assert.equal(recovered.status, 200);

    const reused = await call('POST', '/api/recover-admin', {
      body: {
        username: 'admin',
        code: generated.data.code,
        password: 'MatKhauKhac987',
      },
    });
    assert.equal(reused.status, 401);
    await login('admin', 'MatKhauMoi987');
  });
});
