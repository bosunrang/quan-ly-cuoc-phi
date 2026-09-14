'use strict';

const XLSX = require('xlsx-js-style');
const { writeAudit } = require('../audit.cjs');
const { canSeeEveryone } = require('../permissions.cjs');
const { badRequest, isIsoDate } = require('../http.cjs');

const EMPLOYEE_PAGE = 'reports_employee';
const CARRIER_PAGE = 'reports_carrier';
const FUEL_PRICE_PAGE = 'reports_fuel_price';
const number = (value) => Number(value || 0);

function filters(query, allowAll = false) {
  const from = String(query.from ?? '').trim();
  const to = String(query.to ?? '').trim();
  const employeeId = String(query.employeeId ?? '').trim();
  const all = allowAll && String(query.all ?? '') === '1';
  if (all) {
    if (employeeId && (!Number.isInteger(Number(employeeId)) || Number(employeeId) < 1)) {
      throw badRequest('Nhân viên không hợp lệ.');
    }
    return { from: '', to: '', employeeId: employeeId ? Number(employeeId) : null, all: true };
  }
  if (!isIsoDate(from) || !isIsoDate(to)) throw badRequest('Vui lòng chọn khoảng ngày hợp lệ.');
  if (from > to) throw badRequest('Từ ngày không thể sau đến ngày.');
  if (employeeId && (!Number.isInteger(Number(employeeId)) || Number(employeeId) < 1)) {
    throw badRequest('Nhân viên không hợp lệ.');
  }
  return {
    from,
    to,
    employeeId: employeeId ? Number(employeeId) : null,
    ...(allowAll ? { all: false } : {}),
  };
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
    const employeeId = String(item?.employeeId ?? '').trim();
    if (employeeId && (!Number.isInteger(Number(employeeId)) || Number(employeeId) < 1)) {
      throw badRequest('Nhân viên chịu chi phí khác không hợp lệ.');
    }
    return { name, amount, employeeId: employeeId ? Number(employeeId) : null };
  }).filter(Boolean);
}

function fuelHistoryFilters(query) {
  const from = String(query.from ?? '').trim();
  const to = String(query.to ?? '').trim();
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    throw badRequest('Vui lòng chọn khoảng ngày hợp lệ.');
  }
  const fuelType = String(query.fuelType ?? '').trim().slice(0, 100);
  const employeeId = String(query.employeeId ?? '').trim();
  if (employeeId && (!Number.isInteger(Number(employeeId)) || Number(employeeId) < 1)) {
    throw badRequest('Nhân viên không hợp lệ.');
  }
  const pagination = String(query.pagination ?? '1') !== '0';
  const limit = Number(query.limit ?? 20);
  const offset = Number(query.offset ?? 0);
  if (pagination && (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)) {
    throw badRequest('Phân trang không hợp lệ.');
  }
  return {
    from,
    to,
    fuelType,
    employeeId: employeeId ? Number(employeeId) : null,
    limit: pagination ? limit : null,
    offset: pagination ? offset : 0,
  };
}

function fuelHistoryReport(db, input) {
  const where = ['period_from >= ?', 'period_to <= ?'];
  const params = [input.from, input.to];
  if (input.fuelType) {
    where.push('fuel_type = ?');
    params.push(input.fuelType);
  }
  if (input.employeeId) {
    where.push('employee_id = ?');
    params.push(input.employeeId);
  }
  const whereSql = where.map((clause) => `f.${clause}`).join(' AND ');
  const recordsTotal = Number(
    db.prepare(`SELECT COUNT(*) AS count FROM fuel_records f WHERE ${whereSql}`).get(...params).count,
  );
  const rows = db.prepare(
    `SELECT f.*, e.full_name AS employee_name
       FROM fuel_records f LEFT JOIN employees e ON e.id = f.employee_id
       WHERE ${whereSql}
       ORDER BY f.period_to DESC, f.id DESC${input.limit === null ? '' : ' LIMIT ? OFFSET ?'}`,
  ).all(...params, ...(input.limit === null ? [] : [input.limit, input.offset]));
  const legsByRecordId = new Map();
  if (rows.length) {
    const recordIds = rows.map((row) => row.id);
    const placeholders = recordIds.map(() => '?').join(', ');
    const legs = db.prepare(
      `SELECT fuel_record_id, sequence_no, from_name, to_name, distance_km
         FROM fuel_record_legs
        WHERE fuel_record_id IN (${placeholders})
        ORDER BY fuel_record_id, sequence_no`,
    ).all(...recordIds);
    legs.forEach((leg) => {
      const recordLegs = legsByRecordId.get(leg.fuel_record_id) || [];
      recordLegs.push({
        sequenceNo: Number(leg.sequence_no),
        from: leg.from_name,
        to: leg.to_name,
        km: Number(leg.distance_km),
      });
      legsByRecordId.set(leg.fuel_record_id, recordLegs);
    });
  }
  const items = rows.map((row) => ({
    id: Number(row.id),
    periodFrom: row.period_from,
    periodTo: row.period_to,
    employeeName: row.employee_name || 'Chưa gán nhân viên',
    distanceKm: Number(row.distance_km),
    consumptionLiters: Number(row.consumption_liters),
    consumptionBaseKm: Number(row.consumption_base_km),
    fuelType: row.fuel_type,
    region: row.region,
    fuelPrice: Number(row.fuel_price),
    totalFee: Number(row.total_fee),
    status: row.status,
    voidReason: row.void_reason || '',
    legs: legsByRecordId.get(row.id) || [],
  }));
  return {
    items,
    recordsTotal,
    employees: db.prepare('SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all().map((row) => ({ id: Number(row.id), fullName: row.full_name })),
  };
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
  const fuelWhere = ["f.status = 'active'", 'f.period_from >= ?', 'f.period_to <= ?'];
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
  const where = ['e.transport_fee <> r.transport_fee'];
  const params = [];
  if (!input.all) {
    where.unshift('e.entry_date >= ?', 'e.entry_date <= ?');
    params.push(input.from, input.to);
  }
  if (input.employeeId) { where.push('e.employee_id = ?'); params.push(input.employeeId); }
  return db.prepare(
    `SELECT e.id, ca.name AS carrier, cu.customer_name AS customer,
       COALESCE((
         SELECT province_city FROM misa_rows
          WHERE customer_key = cu.customer_key AND province_city <> ''
          ORDER BY document_date DESC, id DESC LIMIT 1
       ), '') AS province_city, e.spec,
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
     WHERE ${where.join(' AND ')}
     ORDER BY ca.name COLLATE NOCASE, cu.customer_name COLLATE NOCASE, e.entry_date ASC, e.id ASC`,
  ).all(...params).map((row) => ({
    id: Number(row.id), carrier: row.carrier, customer: row.customer,
    provinceCity: row.province_city || '',
    spec: row.spec || '—', actualFee: Number(row.actual_fee),
    standardFee: Number(row.standard_fee), difference: Number(row.difference),
    varianceNote: row.rate_variance_note || '',
  }));
}

const formatDate = (value) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
const formatFileDate = (value) => `${value.slice(8, 10)}-${value.slice(5, 7)}-${value.slice(0, 4)}`;
const fileNamePart = (value) => String(value || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
const baseStyle = { font: { name: 'Times New Roman', sz: 11 }, alignment: { vertical: 'center', wrapText: true }, border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } }, left: { style: 'thin', color: { rgb: '000000' } }, right: { style: 'thin', color: { rgb: '000000' } } } };
const centered = { ...baseStyle, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
const money = { ...baseStyle, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: '#,##0' };
const heading = { ...centered, font: { name: 'Times New Roman', sz: 11, bold: true } };
function set(ws, cell, value, style) { ws[cell] = { t: typeof value === 'number' ? 'n' : 's', v: value, s: style }; }
function merge(ws, range) { (ws['!merges'] ??= []).push(XLSX.utils.decode_range(range)); }

function employeeCosts(data, employeeId) {
  const rows = data.entries.filter((row) => row.employee_id === employeeId);
  const fuel = data.fuels.filter((row) => row.employee_id === employeeId).reduce((sum, row) => sum + number(row.total_fee), 0);
  const transport = rows.reduce((sum, row) => sum + number(row.transport_fee), 0);
  const gate = rows.reduce((sum, row) => sum + number(row.gate_fee), 0);
  return { rows, transport, gate, fuel, total: transport + gate + fuel };
}

function dailySheet(data, input, employee, extras) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const { rows, transport, gate, fuel, total } = employeeCosts(data, employee.id);
  const companyName = data.company.company_name || 'CÔNG TY';
  const companyAddress = data.company.company_address || '';
  ws['!cols'] = [{ wch: 7.5 }, { wch: 15.5 }, { wch: 22 }, { wch: 38.5 }, { wch: 18.5 }, { wch: 18.5 }, { wch: 18.5 }, { wch: 40.5 }];
  set(ws, 'A1', companyName, { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }); merge(ws, 'A1:C2');
  set(ws, 'G1', 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'G1:H1');
  set(ws, 'G2', 'Độc lập - Tự do - Hạnh phúc', { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'G2:H2');
  set(ws, 'A4', 'BẢNG KÊ CƯỚC GỬI HÀNG', { font: { name: 'Times New Roman', sz: 16, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'A4:H4');
  set(ws, 'A5', `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, { font: { name: 'Times New Roman', sz: 11, italic: true }, alignment: { horizontal: 'center' } }); merge(ws, 'A5:H5');
  const companyInfo = { font: { name: 'Times New Roman', sz: 11 } };
  set(ws, 'A7', `Đơn vị: ${companyName}`, companyInfo); merge(ws, 'A7:H7');
  set(ws, 'A8', `Địa chỉ: ${companyAddress}`, companyInfo); merge(ws, 'A8:H8');
  set(ws, 'A9', `Nhân viên phụ trách: ${employee.full_name}`, companyInfo); merge(ws, 'A9:H9');
  ['STT', 'Ngày gửi', 'Nhà xe', 'Khách hàng', 'Tỉnh/TP', 'Quy cách', 'Cước vận chuyển', 'Ghi chú'].forEach((value, index) => set(ws, XLSX.utils.encode_cell({ r: 10, c: index }), value, heading));
  rows.forEach((row, index) => {
    const values = [index + 1, formatDate(row.entry_date), row.carrier, row.customer, row.province_city || '', row.spec, number(row.transport_fee), row.note || ''];
    values.forEach((value, column) => set(ws, XLSX.utils.encode_cell({ r: 11 + index, c: column }), value, column === 6 ? money : [0, 1, 2, 4, 5].includes(column) ? centered : baseStyle));
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
  addSummary(grandTotalRow, 'TỔNG THANH TOÁN', total + extraTotal, true);
  const signDateRow = grandTotalRow + 2;
  const signRow = grandTotalRow + 3;
  const signature = { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center', vertical: 'center' } };
  set(ws, `H${signDateRow}`, 'Ngày… tháng…năm….', { font: { name: 'Times New Roman', sz: 11, italic: true }, alignment: { horizontal: 'center', vertical: 'center' } });
  set(ws, `A${signRow}`, 'Giám Đốc Duyệt', signature); set(ws, `B${signRow}`, '', signature); merge(ws, `A${signRow}:B${signRow}`);
  set(ws, `D${signRow}`, 'Kế Toán Trưởng', signature);
  set(ws, `H${signRow}`, 'Người lập', signature);
  ws['!rows'] ??= [];
  ws['!rows'][0] = { hpt: 18 };
  ws['!rows'][1] = { hpt: 18 };
  ws['!rows'][3] = { hpt: 20.25 };
  ws['!ref'] = `A1:H${signRow}`;
  return ws;
}

function dailySummarySheet(data, input, employees, extras) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const companyName = data.company.company_name || 'CÔNG TY';
  const companyAddress = data.company.company_address || '';
  const rows = employees.map((employee) => ({
    employee,
    ...employeeCosts(data, employee.id),
    extra: extras.filter((item) => item.employeeId === employee.id).reduce((sum, item) => sum + item.amount, 0),
  }));
  rows.forEach((row) => { row.totalPayment = row.total + row.extra; });
  ws['!cols'] = [{ wch: 7.5 }, { wch: 28 }, { wch: 19 }, { wch: 17 }, { wch: 17 }, { wch: 17 }, { wch: 21 }];
  set(ws, 'A1', companyName, { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }); merge(ws, 'A1:C2');
  set(ws, 'E1', 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'E1:G1');
  set(ws, 'E2', 'Độc lập - Tự do - Hạnh phúc', { font: { name: 'Times New Roman', sz: 11, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'E2:G2');
  set(ws, 'A4', 'BẢNG TỔNG HỢP CƯỚC NHÂN VIÊN', { font: { name: 'Times New Roman', sz: 16, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'A4:G4');
  set(ws, 'A5', `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, { font: { name: 'Times New Roman', sz: 11, italic: true }, alignment: { horizontal: 'center' } }); merge(ws, 'A5:G5');
  const companyInfo = { font: { name: 'Times New Roman', sz: 11 } };
  set(ws, 'A7', `Đơn vị: ${companyName}`, companyInfo); merge(ws, 'A7:G7');
  set(ws, 'A8', `Địa chỉ: ${companyAddress}`, companyInfo); merge(ws, 'A8:G8');
  ['STT', 'Nhân viên', 'Cước vận chuyển', 'Phí vào cổng', 'Tiền xăng', 'Chi phí khác', 'Tổng cộng'].forEach((value, index) => set(ws, XLSX.utils.encode_cell({ r: 9, c: index }), value, heading));
  rows.forEach((row, index) => {
    const values = [index + 1, row.employee.full_name, row.transport, row.gate, row.fuel, row.extra, row.totalPayment];
    values.forEach((value, column) => set(ws, XLSX.utils.encode_cell({ r: 10 + index, c: column }), value, column === 0 ? centered : column === 1 ? baseStyle : money));
  });
  const totalRow = 10 + rows.length;
  const totals = rows.reduce((sum, row) => ({
    transport: sum.transport + row.transport,
    gate: sum.gate + row.gate,
    fuel: sum.fuel + row.fuel,
    extra: sum.extra + row.extra,
    total: sum.total + row.totalPayment,
  }), { transport: 0, gate: 0, fuel: 0, extra: 0, total: 0 });
  const totalStyle = { ...heading, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
  set(ws, XLSX.utils.encode_cell({ r: totalRow, c: 0 }), 'TỔNG CỘNG', totalStyle);
  set(ws, XLSX.utils.encode_cell({ r: totalRow, c: 1 }), '', totalStyle);
  merge(ws, `A${totalRow + 1}:B${totalRow + 1}`);
  [totals.transport, totals.gate, totals.fuel, totals.extra, totals.total].forEach((value, index) => set(ws, XLSX.utils.encode_cell({ r: totalRow, c: index + 2 }), value, { ...money, font: { name: 'Times New Roman', sz: 11, bold: true } }));
  const grandTotalRow = totalRow + 2;
  set(ws, XLSX.utils.encode_cell({ r: grandTotalRow, c: 4 }), 'TỔNG THANH TOÁN', totalStyle);
  set(ws, XLSX.utils.encode_cell({ r: grandTotalRow, c: 5 }), '', totalStyle);
  merge(ws, `E${grandTotalRow + 1}:F${grandTotalRow + 1}`);
  set(ws, XLSX.utils.encode_cell({ r: grandTotalRow, c: 6 }), totals.total, { ...money, font: { name: 'Times New Roman', sz: 11, bold: true } });
  ws['!rows'] = [{ hpt: 18 }, { hpt: 18 }, {}, { hpt: 20.25 }];
  ws['!ref'] = `A1:G${grandTotalRow + 1}`;
  return ws;
}

function annualSheet(data, year, employee) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const rows = data.entries.filter((row) => row.employee_id === employee.id);
  ws['!cols'] = [{ wch: 15 }, { wch: 22 }, { wch: 38 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 42 }];
  set(ws, 'A1', `BẢNG TỔNG HỢP CƯỚC GỬI HÀNG NĂM ${year} — ${employee.full_name}`, { font: { name: 'Times New Roman', sz: 16, bold: true }, alignment: { horizontal: 'center' } }); merge(ws, 'A1:I1');
  ['Ngày gửi', 'Nhà xe', 'Khách hàng', 'Tỉnh/ TP', 'Người nhận', 'Quy cách', 'Cước vận chuyển', 'Phí vào cổng', 'Ghi chú'].forEach((value, index) => set(ws, XLSX.utils.encode_cell({ r: 2, c: index }), value, heading));
  rows.forEach((row, index) => {
    const values = [formatDate(row.entry_date), row.carrier, row.customer, row.province_city || '', row.recipient, row.spec, number(row.transport_fee), number(row.gate_fee), row.note || ''];
    values.forEach((value, column) => set(ws, XLSX.utils.encode_cell({ r: 3 + index, c: column }), value, [6, 7].includes(column) ? money : [0, 1, 3, 4, 5].includes(column) ? centered : baseStyle));
    ws['!rows'] ??= [];
    ws['!rows'][3 + index] = { hpt: (row.note || '').length > 80 ? 45 : 30 };
  });
  ws['!rows'] ??= [];
  ws['!rows'][0] = { hpt: 24 };
  ws['!rows'][2] = { hpt: 30 };
  ws['!ref'] = `A1:I${Math.max(4, rows.length + 3)}`;
  return ws;
}

function fuelHistorySheet(items, input, employeeName, company) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const whiteFill = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } };
  const metaStyle = { font: { name: 'Times New Roman', sz: 11 }, alignment: { vertical: 'center' } };
  const centerStyle = { ...centered, fill: whiteFill };
  const headerStyle = { ...heading, fill: whiteFill, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
  const routeStyle = { ...baseStyle, fill: whiteFill, alignment: { horizontal: 'left', vertical: 'center', wrapText: true } };
  const totalStyle = { ...centered, fill: whiteFill, numFmt: '#,##0' };
  ws['!cols'] = [
    { wch: 8 }, { wch: 22 }, { wch: 67 }, { wch: 22 }, { wch: 16 }, { wch: 17 },
  ];
  set(ws, 'A1', 'BẢNG THỐNG KÊ TIỀN XĂNG', {
    font: { name: 'Times New Roman', sz: 16, bold: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  });
  merge(ws, 'A1:F1');
  set(ws, 'A2', `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, {
    font: { name: 'Times New Roman', sz: 11, italic: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  });
  merge(ws, 'A2:F2');
  set(ws, 'A4', `Đơn vị: ${company.company_name || ''}`, metaStyle);
  set(ws, 'A5', `Địa chỉ: ${company.company_address || ''}`, metaStyle);
  set(ws, 'A6', `Nhân viên: ${employeeName}`, metaStyle);
  ['STT', 'Kỳ tính', 'Lộ trình di chuyển', 'Quãng đường', 'Giá xăng', 'Tổng tiền'].forEach(
    (value, index) => set(ws, XLSX.utils.encode_cell({ r: 7, c: index }), value, headerStyle),
  );

  let row = 8;
  items.forEach((item, index) => {
    const legs = item.legs.length
      ? item.legs
      : [{ from: 'Chưa lưu chi tiết lộ trình', to: '', km: item.distanceKm }];
    const lastRow = row + legs.length - 1;
    legs.forEach((leg, legIndex) => {
      const excelRow = row + legIndex;
      const route = leg.to ? `${leg.from} → ${leg.to}` : leg.from;
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 0 }), legIndex ? '' : index + 1, centerStyle);
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 1 }), legIndex ? '' : `${formatDate(item.periodFrom)} - ${formatDate(item.periodTo)}`, centerStyle);
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 2 }), route, routeStyle);
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 3 }), `${Number(leg.km).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} Km`, centerStyle);
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 4 }), legIndex ? '' : item.fuelPrice, totalStyle);
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 5 }), legIndex ? '' : item.totalFee, totalStyle);
      ws['!rows'] ??= [];
      ws['!rows'][excelRow] = { hpt: route.length > 210 ? 60 : route.length > 120 ? 45 : 30 };
    });
    if (legs.length > 1) {
      for (const column of ['A', 'B', 'E', 'F']) merge(ws, `${column}${row + 1}:${column}${lastRow + 1}`);
    }
    row = lastRow + 1;
  });
  ws['!rows'] ??= [];
  ws['!rows'][0] = { hpt: 20.25 };
  ws['!rows'][7] = { hpt: 30 };
  ws['!ref'] = `A1:F${row}`;
  return ws;
}

function uniqueSheetName(name, used) {
  const base = String(name || 'Chưa gán nhân viên').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Chưa gán nhân viên';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 28)} (${suffix})`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function carrierVarianceSheet(items, input) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  ws['!cols'] = [
    { wch: 7 }, { wch: 22 }, { wch: 32 }, { wch: 18 }, { wch: 22 },
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 46 },
  ];
  set(ws, 'A1', 'BÁO CÁO CHÊNH LỆCH CƯỚC NHÀ XE', {
    font: { name: 'Times New Roman', sz: 15, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A1:I1');
  set(ws, 'A2', input.all ? 'Toàn bộ thời gian' : `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, {
    font: { name: 'Times New Roman', sz: 11, italic: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A2:I2');
  ['STT', 'Nhà xe', 'Khách hàng', 'Tỉnh/TP', 'Quy cách', 'Giá thiết lập', 'Giá nhập', 'Chênh lệch', 'Ghi chú'].forEach(
    (value, index) => set(ws, XLSX.utils.encode_cell({ r: 3, c: index }), value, heading),
  );
  items.forEach((item, index) => {
    const values = [
      index + 1, item.carrier, item.customer, item.provinceCity || '', item.spec,
      item.standardFee, item.actualFee, item.difference, item.varianceNote,
    ];
    values.forEach((value, column) => set(
      ws,
      XLSX.utils.encode_cell({ r: 4 + index, c: column }),
      value,
      [0, 1, 3, 4].includes(column) ? centered : [5, 6, 7].includes(column) ? money : baseStyle,
    ));
  });
  const totalRow = 4 + items.length;
  const totalDifference = items.reduce((sum, item) => sum + item.difference, 0);
  const totalBorder = { ...baseStyle.border, bottom: { style: 'thin', color: { rgb: '000000' } } };
  const totalLabel = { ...heading, border: totalBorder };
  for (let column = 0; column < 7; column += 1) {
    set(ws, XLSX.utils.encode_cell({ r: totalRow, c: column }), column === 0 ? 'TỔNG CHÊNH LỆCH' : '', totalLabel);
  }
  merge(ws, `A${totalRow + 1}:G${totalRow + 1}`);
  set(ws, `H${totalRow + 1}`, totalDifference, { ...money, font: { name: 'Times New Roman', sz: 11, bold: true }, border: totalBorder });
  ws['!ref'] = `A1:I${totalRow + 1}`;
  return ws;
}

function register(router) {
  router.get('/api/reports/fuel-history/export', async (c) => {
    c.requirePage(FUEL_PRICE_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xuất báo cáo tiền xăng.');
    const input = fuelHistoryFilters({ ...c.query, pagination: '0' });
    const report = fuelHistoryReport(c.db, input);
    if (!report.items.length) throw badRequest('Không có kỳ tính xăng phù hợp để xuất Excel.');
    const groups = new Map();
    report.items.forEach((item) => {
      const name = item.employeeName || 'Chưa gán nhân viên';
      const records = groups.get(name) || [];
      records.push(item);
      groups.set(name, records);
    });
    const company = c.db.prepare('SELECT company_name, company_address FROM app_settings WHERE id = 1').get() || {};
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();
    for (const [employeeName, items] of groups) {
      XLSX.utils.book_append_sheet(
        workbook,
        fuelHistorySheet(items, input, employeeName, company),
        uniqueSheetName(employeeName, usedNames),
      );
    }
    const contentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx', compression: true });
    writeAudit(c.db, c.user, 'report.fuel_history.export', 'report', null, { ...input, rows: report.items.length, sheetCount: workbook.SheetNames.length });
    const employeeName = input.employeeId
      ? c.db.prepare('SELECT full_name FROM employees WHERE id = ?').get(input.employeeId)?.full_name || 'Chưa gán nhân viên'
      : 'Tất cả nhân viên';
    return {
      fileName: `Bảng thống kê tiền xăng - ${fileNamePart(employeeName)} - từ ngày ${formatFileDate(input.from)} đến ${formatFileDate(input.to)}.xlsx`,
      contentBase64,
    };
  });

  router.get('/api/reports/fuel-history', async (c) => {
    c.requirePage(FUEL_PRICE_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xem báo cáo tiền xăng.');
    return fuelHistoryReport(c.db, fuelHistoryFilters(c.query));
  });

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
    const input = filters(c.query, true);
    const items = carrierVariance(c.db, input);
    const employees = c.db.prepare('SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all();
    return {
      employees: employees.map((item) => ({ id: item.id, fullName: item.full_name })),
      items,
      summary: {
        entries: items.length,
        difference: items.reduce((sum, item) => sum + item.difference, 0),
      },
    };
  });
  router.get('/api/reports/carrier-variance/export', async (c) => {
    c.requirePage(CARRIER_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xuất báo cáo.');
    const input = filters(c.query, true);
    const items = carrierVariance(c.db, input);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, carrierVarianceSheet(items, input), 'Chênh lệch cước');
    const contentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx', compression: true });
    writeAudit(c.db, c.user, 'report.carrier_variance.export', 'report', null, { ...input, rows: items.length });
    return {
      fileName: input.all ? 'Bao cao chenh lech cuoc nha xe.xlsx' : `Bao cao chenh lech cuoc nha xe ${input.from} den ${input.to}.xlsx`,
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
      if (!selected.length) throw badRequest('Không có nhân viên đang hoạt động để xuất báo cáo.');
      if (!input.employeeId && extras.some((item) => !selected.some((employee) => employee.id === item.employeeId))) {
        throw badRequest('Vui lòng chọn nhân viên chịu phí cho từng chi phí khác.');
      }
      if (input.employeeId) {
        XLSX.utils.book_append_sheet(workbook, dailySheet(data, input, selected[0], extras), 'Bảng kê cước');
      } else {
        XLSX.utils.book_append_sheet(workbook, dailySummarySheet(data, input, selected, extras), 'Tổng hợp');
        for (const employee of selected) {
          XLSX.utils.book_append_sheet(
            workbook,
            dailySheet(data, input, employee, extras.filter((item) => item.employeeId === employee.id)),
            employee.full_name.slice(0, 31),
          );
        }
      }
    } else if (type === 'annual') {
      const year = input.from.slice(0, 4);
      for (const employee of selected) {
        if (data.entries.some((row) => row.employee_id === employee.id)) XLSX.utils.book_append_sheet(workbook, annualSheet(data, year, employee), employee.full_name.slice(0, 31));
      }
      if (!workbook.SheetNames.length) throw badRequest('Không có phiếu chi phí trong năm đã chọn.');
    } else throw badRequest('Loại báo cáo không hợp lệ.');
    const contentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx', compression: true });
    const suffix = type === 'annual'
      ? `Tổng hợp năm ${input.from.slice(0, 4)}`
      : input.employeeId
        ? `Bảng kê ${selected[0].full_name} từ ${formatFileDate(input.from)} đến ${formatFileDate(input.to)}`
        : `Bảng kê tất cả nhân viên từ ${formatFileDate(input.from)} đến ${formatFileDate(input.to)}`;
    if (type === 'daily') {
      const finalWhere = ["status = 'active'", 'period_from >= ?', 'period_to <= ?'];
      const finalParams = [input.from, input.to];
      if (input.employeeId) { finalWhere.push('employee_id = ?'); finalParams.push(input.employeeId); }
      c.db.prepare(`UPDATE fuel_records SET finalized_at = COALESCE(finalized_at, ?), finalized_by = COALESCE(finalized_by, ?), updated_at = ? WHERE ${finalWhere.join(' AND ')}`).run(new Date().toISOString(), c.user.id, new Date().toISOString(), ...finalParams);
    }
    writeAudit(c.db, c.user, 'report.export', 'report', null, { type, ...input, extraCosts: extras, sheetCount: workbook.SheetNames.length });
    return { fileName: `${suffix}.xlsx`, contentBase64 };
  });
}

module.exports = { register };
