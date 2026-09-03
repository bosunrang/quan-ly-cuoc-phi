'use strict';

const XLSX = require('xlsx-js-style');
const { writeAudit } = require('../audit.cjs');
const { canSeeEveryone } = require('../permissions.cjs');
const { badRequest } = require('../http.cjs');

const EMPLOYEE_PAGE = 'reports_employee';
const CARRIER_PAGE = 'reports_carrier';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const number = (value) => Number(value || 0);

function filters(query) {
  const from = String(query.from ?? '').trim();
  const to = String(query.to ?? '').trim();
  const employeeId = String(query.employeeId ?? '').trim();
  if (!DATE.test(from) || !DATE.test(to)) throw badRequest('Vui lòng chọn khoảng ngày hợp lệ.');
  if (from > to) throw badRequest('Từ ngày không thể sau đến ngày.');
  if (employeeId && (!Number.isInteger(Number(employeeId)) || Number(employeeId) < 1)) {
    throw badRequest('Nhân viên không hợp lệ.');
  }
  return { from, to, employeeId: employeeId ? Number(employeeId) : null };
}

function extraCosts(query) {
  const raw = String(query.extraCosts ?? '').trim();
  const legacy = raw ? [] : [{ name: query.extraCostName, amount: query.extraCostAmount }];
  let values = legacy;
  if (raw) {
    try { values = JSON.parse(raw); } catch { throw badRequest('Danh sách chi phí khác không hợp lệ.'); }
  }
  if (!Array.isArray(values) || values.length > 20) throw badRequest('Danh sách chi phí khác không hợp lệ.');
  return values.map((item) => {
    const name = String(item?.name ?? '').trim();
    const rawAmount = String(item?.amount ?? '').trim();
    if (!name && !rawAmount) return null;
    if (!name) throw badRequest('Vui lòng nhập tên chi phí khác.');
    const amount = Number(rawAmount.replace(/[^\d]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Số tiền chi phí khác phải lớn hơn 0.');
    return { name, amount };
  }).filter(Boolean);
}

function reportData(db, input) {
  const where = ['e.entry_date >= ?', 'e.entry_date <= ?'];
  const params = [input.from, input.to];
  if (input.employeeId) { where.push('e.employee_id = ?'); params.push(input.employeeId); }
  const entries = db.prepare(
    `SELECT e.*, employees.full_name AS employee_name,
            COALESCE((
              SELECT province_city FROM misa_rows
               WHERE customer_key = vn_normalize(e.customer)
                 AND province_city <> ''
               ORDER BY document_date DESC, id DESC LIMIT 1
            ), '') AS province_city
       FROM entries e LEFT JOIN employees ON employees.id = e.employee_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.entry_date ASC, e.id ASC`,
  ).all(...params);
  const fuelWhere = ['f.period_from >= ?', 'f.period_to <= ?'];
  const fuelParams = [input.from, input.to];
  if (input.employeeId) { fuelWhere.push('f.employee_id = ?'); fuelParams.push(input.employeeId); }
  const fuels = db.prepare(
    `SELECT f.*, employees.full_name AS employee_name
       FROM fuel_records f LEFT JOIN employees ON employees.id = f.employee_id
      WHERE ${fuelWhere.join(' AND ')}
      ORDER BY f.period_from ASC, f.id ASC`,
  ).all(...fuelParams);
  const employees = db.prepare('SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all();
  const years = db.prepare("SELECT DISTINCT substr(entry_date, 1, 4) AS year FROM entries WHERE entry_date <> '' ORDER BY year DESC").all().map((item) => item.year);
  const company = db.prepare('SELECT company_name, company_address FROM app_settings WHERE id = 1').get() || {};
  return { entries, fuels, employees, years, company };
}

function carrierVariance(db, input) {
  const where = ['e.entry_date >= ?', 'e.entry_date <= ?'];
  const params = [input.from, input.to];
  if (input.employeeId) { where.push('e.employee_id = ?'); params.push(input.employeeId); }
  return db.prepare(
    `SELECT e.id, ca.name AS carrier, cu.customer_name AS customer, e.spec,
       r.transport_fee AS standard_fee, e.transport_fee AS actual_fee,
       e.transport_fee - r.transport_fee AS difference, e.rate_variance_note
     FROM entries e
     INNER JOIN customers cu ON cu.customer_key = vn_normalize(e.customer)
     INNER JOIN carriers ca ON ca.carrier_key = vn_normalize(e.carrier)
     INNER JOIN carrier_customer_rates r ON r.id = (
       SELECT id FROM carrier_customer_rates
        WHERE customer_id = cu.id AND carrier_id = ca.id
          AND (spec_key = vn_normalize(e.spec) OR is_default = 1)
        ORDER BY CASE WHEN spec_key = vn_normalize(e.spec) THEN 0 ELSE 1 END, id
        LIMIT 1
     )
     WHERE ${where.join(' AND ')} AND e.transport_fee <> r.transport_fee
     ORDER BY ca.name COLLATE NOCASE, cu.customer_name COLLATE NOCASE, e.entry_date ASC, e.id ASC`,
  ).all(...params).map((row) => ({
    id: Number(row.id), carrier: row.carrier, customer: row.customer,
    spec: row.spec || '—', actualFee: Number(row.actual_fee),
    standardFee: Number(row.standard_fee), difference: Number(row.difference),
    varianceNote: row.rate_variance_note || '',
  }));
}

const formatDate = (value) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
const customerWithProvince = (row) => row.province_city ? `${row.customer} - ${row.province_city}` : row.customer;
const baseStyle = { font: { name: 'Times New Roman', sz: 11 }, alignment: { vertical: 'center', wrapText: true }, border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } }, left: { style: 'thin', color: { rgb: '000000' } }, right: { style: 'thin', color: { rgb: '000000' } } } };
const centered = { ...baseStyle, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
const money = { ...baseStyle, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: '#,##0' };
const heading = { ...centered, font: { name: 'Times New Roman', sz: 11, bold: true } };
function set(ws, cell, value, style) { ws[cell] = { t: typeof value === 'number' ? 'n' : 's', v: value, s: style }; }
function merge(ws, range) { (ws['!merges'] ??= []).push(XLSX.utils.decode_range(range)); }

function dailySheet(data, input, employee, extras) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const rows = data.entries.filter((row) => row.employee_id === employee.id);
  const fuel = data.fuels.filter((row) => row.employee_id === employee.id).reduce((sum, row) => sum + number(row.total_fee), 0);
  const transport = rows.reduce((sum, row) => sum + number(row.transport_fee), 0);
  const gate = rows.reduce((sum, row) => sum + number(row.gate_fee), 0);
  const companyName = data.company.company_name || 'CÔNG TY';
  const companyAddress = data.company.company_address || '';
  ws['!cols'] = [{ wch: 7.5 }, { wch: 15.5 }, { wch: 38.5 }, { wch: 18.5 }, { wch: 18.5 }, { wch: 40.5 }];
  set(ws, 'A1', companyName, { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center', vertical: 'center' } }); merge(ws, 'A1:C1');
  set(ws, 'D1', 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'D1:F1');
  set(ws, 'D2', 'Độc lập - Tự do - Hạnh phúc', { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'D2:F2');
  set(ws, 'A4', 'BẢNG KÊ CƯỚC GỬI HÀNG', { font: { name: 'Times New Roman', sz: 16, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'A4:F4');
  set(ws, 'A5', `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, { font: { name: 'Times New Roman', sz: 11, italic: true }, alignment: { horizontal: 'center' } }); merge(ws, 'A5:F5');
  const companyInfo = { font: { name: 'Times New Roman', sz: 11 } };
  set(ws, 'A7', `Đơn vị: ${companyName}`, companyInfo); merge(ws, 'A7:F7');
  set(ws, 'A8', `Địa chỉ: ${companyAddress}`, companyInfo); merge(ws, 'A8:F8');
  set(ws, 'A9', `Nhân viên phụ trách: ${employee.full_name}`, companyInfo); merge(ws, 'A9:F9');
  ['STT', 'Ngày gửi', 'Khách hàng', 'Quy cách', 'Cước vận chuyển', 'Ghi chú'].forEach((value, index) => set(ws, XLSX.utils.encode_cell({ r: 10, c: index }), value, heading));
  rows.forEach((row, index) => {
    const values = [index + 1, formatDate(row.entry_date), customerWithProvince(row), row.spec, number(row.transport_fee), row.note || ''];
    values.forEach((value, column) => set(ws, XLSX.utils.encode_cell({ r: 11 + index, c: column }), value, column === 4 ? money : [0, 1, 3].includes(column) ? centered : baseStyle));
    ws['!rows'] ??= [];
    ws['!rows'][11 + index] = { hpt: (row.note || '').length > 80 ? 45 : 30 };
  });
  const totalRow = 11 + rows.length;
  const summaryRow = totalRow + 2;
  const summaryLabel = { ...baseStyle, font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'left', vertical: 'center', wrapText: true } };
  const addSummary = (row, label, value, emphasized = false) => {
    set(ws, `A${row}`, label, summaryLabel);
    set(ws, `B${row}`, '', summaryLabel);
    merge(ws, `A${row}:B${row}`);
    set(ws, `C${row}`, value, emphasized ? { ...money, font: { name: 'Times New Roman', sz: 11, bold: true } } : money);
  };
  addSummary(summaryRow, 'Cước vận chuyển', transport);
  addSummary(summaryRow + 1, 'Phí vào cổng', gate);
  addSummary(summaryRow + 2, 'Tiền xăng', fuel);
  extras.forEach((extra, index) => {
    const row = summaryRow + 3 + index;
    addSummary(row, extra.name, extra.amount);
  });
  const grandTotalRow = summaryRow + 3 + extras.length;
  const extraTotal = extras.reduce((sum, item) => sum + item.amount, 0);
  addSummary(grandTotalRow, 'TỔNG THANH TOÁN', transport + gate + fuel + extraTotal, true);
  const signDateRow = grandTotalRow + 2;
  const signRow = grandTotalRow + 3;
  const signature = { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center', vertical: 'center' } };
  set(ws, `F${signDateRow}`, 'Ngày… tháng…năm….', { font: { name: 'Times New Roman', sz: 11, italic: true }, alignment: { horizontal: 'center', vertical: 'center' } });
  set(ws, `A${signRow}`, 'Giám Đốc Duyệt', signature); set(ws, `B${signRow}`, '', signature); merge(ws, `A${signRow}:B${signRow}`);
  set(ws, `D${signRow}`, 'Kế Toán Trưởng', signature);
  set(ws, `F${signRow}`, 'Người lập', signature);
  ws['!rows'] ??= [];
  ws['!rows'][3] = { hpt: 20.25 };
  ws['!ref'] = `A1:F${signRow}`;
  return ws;
}

function annualSheet(data, year, employee) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const rows = data.entries.filter((row) => row.employee_id === employee.id);
  ws['!cols'] = [{ wch: 15 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 38 }, { wch: 42 }];
  set(ws, 'A1', `BẢNG TỔNG HỢP CƯỚC GỬI HÀNG NĂM ${year} — ${employee.full_name}`, { font: { name: 'Times New Roman', sz: 15, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'A1:I1');
  ['Ngày gửi', 'Nhà xe', 'Người nhận', 'Quy cách', 'Cước vận chuyển', 'Phí vào cổng', 'Tổng phiếu', 'Khách hàng', 'Ghi chú'].forEach((value, index) => set(ws, XLSX.utils.encode_cell({ r: 2, c: index }), value, heading));
  rows.forEach((row, index) => {
    const values = [formatDate(row.entry_date), row.carrier, row.recipient, row.spec, number(row.transport_fee), number(row.gate_fee), number(row.total_fee), customerWithProvince(row), row.note || ''];
    values.forEach((value, column) => set(ws, XLSX.utils.encode_cell({ r: 3 + index, c: column }), value, [4, 5, 6].includes(column) ? money : [0, 1, 2, 3].includes(column) ? centered : baseStyle));
  });
  ws['!ref'] = `A1:I${Math.max(4, rows.length + 3)}`;
  return ws;
}

function carrierVarianceSheet(items, input) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  ws['!cols'] = [
    { wch: 7 }, { wch: 22 }, { wch: 32 }, { wch: 22 },
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 46 },
  ];
  set(ws, 'A1', 'BÁO CÁO CHÊNH LỆCH CƯỚC NHÀ XE', {
    font: { name: 'Times New Roman', sz: 15, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A1:H1');
  set(ws, 'A2', `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, {
    font: { name: 'Times New Roman', sz: 11, italic: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A2:H2');
  ['STT', 'Nhà xe', 'Khách hàng', 'Quy cách', 'Giá thiết lập', 'Giá nhập', 'Chênh lệch', 'Ghi chú'].forEach(
    (value, index) => set(ws, XLSX.utils.encode_cell({ r: 3, c: index }), value, heading),
  );
  items.forEach((item, index) => {
    const values = [
      index + 1, item.carrier, item.customer, item.spec,
      item.standardFee, item.actualFee, item.difference, item.varianceNote,
    ];
    values.forEach((value, column) => set(
      ws,
      XLSX.utils.encode_cell({ r: 4 + index, c: column }),
      value,
      [0, 1, 3].includes(column) ? centered : [4, 5, 6].includes(column) ? money : baseStyle,
    ));
  });
  const totalRow = 4 + items.length;
  const totalDifference = items.reduce((sum, item) => sum + item.difference, 0);
  const totalBorder = { ...baseStyle.border, bottom: { style: 'thin', color: { rgb: '000000' } } };
  const totalLabel = { ...heading, border: totalBorder };
  for (let column = 0; column < 6; column += 1) {
    set(ws, XLSX.utils.encode_cell({ r: totalRow, c: column }), column === 0 ? 'TỔNG CHÊNH LỆCH' : '', totalLabel);
  }
  merge(ws, `A${totalRow + 1}:F${totalRow + 1}`);
  set(ws, `G${totalRow + 1}`, totalDifference, { ...money, font: { name: 'Times New Roman', sz: 11, bold: true }, border: totalBorder });
  ws['!ref'] = `A1:H${totalRow + 1}`;
  return ws;
}

function register(router) {
  router.get('/api/reports', async (c) => {
    c.requirePage(EMPLOYEE_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xem báo cáo tổng hợp.');
    const employees = c.db.prepare('SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all();
    const years = c.db.prepare("SELECT DISTINCT substr(entry_date, 1, 4) AS year FROM entries WHERE entry_date <> '' ORDER BY year DESC").all().map((item) => item.year);
    return {
      employees: employees.map((item) => ({ id: item.id, fullName: item.full_name })),
      years,
    };
  });
  router.get('/api/reports/carrier-variance', async (c) => {
    c.requirePage(CARRIER_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xem báo cáo tổng hợp.');
    const items = carrierVariance(c.db, filters(c.query));
    return {
      items,
      summary: {
        entries: items.length,
        absoluteDifference: items.reduce((sum, item) => sum + Math.abs(item.difference), 0),
        difference: items.reduce((sum, item) => sum + item.difference, 0),
      },
    };
  });
  router.get('/api/reports/carrier-variance/export', async (c) => {
    c.requirePage(CARRIER_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xuất báo cáo.');
    const input = filters(c.query);
    const items = carrierVariance(c.db, input);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, carrierVarianceSheet(items, input), 'Chênh lệch cước');
    const contentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx', compression: true });
    writeAudit(c.db, c.user, 'report.carrier_variance.export', 'report', null, { ...input, rows: items.length });
    return {
      fileName: `Bao cao chenh lech cuoc nha xe ${input.from} den ${input.to}.xlsx`,
      contentBase64,
    };
  });
  router.get('/api/reports/export', async (c) => {
    c.requirePage(EMPLOYEE_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xuất báo cáo.');
    const input = filters(c.query);
    const type = String(c.query.type ?? 'daily');
    const extras = type === 'daily' ? extraCosts(c.query) : [];
    const data = reportData(c.db, input);
    const selected = input.employeeId ? data.employees.filter((item) => item.id === input.employeeId) : data.employees;
    const workbook = XLSX.utils.book_new();
    if (type === 'daily') {
      if (!input.employeeId) throw badRequest('Vui lòng chọn nhân viên để xuất bảng kê theo khoảng ngày.');
      if (!selected.length) throw badRequest('Nhân viên không còn hoạt động hoặc không tồn tại.');
      XLSX.utils.book_append_sheet(workbook, dailySheet(data, input, selected[0], extras), 'Bảng kê cước');
    } else if (type === 'annual') {
      const year = input.from.slice(0, 4);
      for (const employee of selected) {
        if (data.entries.some((row) => row.employee_id === employee.id)) XLSX.utils.book_append_sheet(workbook, annualSheet(data, year, employee), employee.full_name.slice(0, 31));
      }
      if (!workbook.SheetNames.length) throw badRequest('Không có phiếu chi phí trong năm đã chọn.');
    } else throw badRequest('Loại báo cáo không hợp lệ.');
    const contentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx', compression: true });
    const suffix = type === 'annual' ? `Tong hop nam ${input.from.slice(0, 4)}` : `Bang ke ${selected[0].full_name} ${input.from} den ${input.to}`;
    writeAudit(c.db, c.user, 'report.export', 'report', null, { type, ...input, extraCosts: extras, sheetCount: workbook.SheetNames.length });
    return { fileName: `${suffix}.xlsx`, contentBase64 };
  });
}

module.exports = { register };
