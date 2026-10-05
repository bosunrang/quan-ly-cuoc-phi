'use strict';

const XLSX = require('xlsx-js-style');
const { strFromU8, strToU8, unzipSync, zipSync } = require('fflate');
const { writeAudit } = require('../audit.cjs');
const { normalizeSearchText } = require('../db.cjs');
const { canSeeEveryone } = require('../permissions.cjs');
const { badRequest, isIsoDate } = require('../http.cjs');

const EMPLOYEE_PAGE = 'reports_employee';
const CARRIER_PAGE = 'reports_carrier';
const FUEL_PRICE_PAGE = 'reports_fuel_price';
const number = (value) => Number(value || 0);

// Ghi chú chỉ giải thích phiếu trùng hoặc chênh lệch cước; trạng thái bill có cột riêng.
const carrierExportNote = (entries) => {
  const seen = new Set();
  return entries
    .flatMap((entry) => [entry.rate_variance_note, entry.duplicate_reason])
    .map((value) => String(value ?? '').trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' / ');
};

// Báo cáo chênh lệch nhà xe chỉ giải thích nguyên nhân chênh lệch cước.
const entryVarianceNote = (entry) => String(entry.rate_variance_note ?? '').trim();

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

/**
 * Nhân viên chỉ được xuất báo cáo cho hồ sơ nhân viên liên kết với tài khoản
 * của họ. Không tin employeeId do máy trạm gửi lên, vì URL có thể bị sửa tay.
 */
function reportInputForUser(db, user, input) {
  if (canSeeEveryone(user)) return input;
  const employee = db
    .prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1')
    .get(user.id);
  return { ...input, employeeId: Number(employee?.id ?? -1) };
}

/** Danh sách nhân viên báo cáo trong đúng phạm vi mà người dùng được xem. */
function reportCatalog(db, employeeId = null) {
  const employeeWhere =
    employeeId === null ? 'WHERE is_active = 1' : 'WHERE id = ? AND is_active = 1';
  const employees = db
    .prepare(
      `SELECT id, full_name FROM employees ${employeeWhere} ORDER BY full_name COLLATE NOCASE`,
    )
    .all(...(employeeId === null ? [] : [employeeId]));
  return {
    employees: employees.map((item) => ({ id: Number(item.id), fullName: item.full_name })),
  };
}

function extraCosts(query) {
  const raw = String(query.extraCosts ?? '').trim();
  const legacy = raw ? [] : [{ name: query.extraCostName, amount: query.extraCostAmount }];
  let values = legacy;
  if (raw) {
    try {
      values = JSON.parse(raw);
    } catch {
      throw badRequest('Danh sách chi phí khác không hợp lệ.');
    }
  }
  if (!Array.isArray(values) || values.length > 20)
    throw badRequest('Danh sách chi phí khác không hợp lệ.');
  return values
    .map((item) => {
      const name = String(item?.name ?? '').trim();
      const rawAmount = String(item?.amount ?? '').trim();
      if (!name && !rawAmount) return null;
      if (!name) throw badRequest('Vui lòng nhập tên chi phí khác.');
      const amount = Number(rawAmount.replace(/[^\d]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0)
        throw badRequest('Số tiền chi phí khác phải lớn hơn 0.');
      const employeeId = String(item?.employeeId ?? '').trim();
      if (employeeId && (!Number.isInteger(Number(employeeId)) || Number(employeeId) < 1)) {
        throw badRequest('Nhân viên chịu chi phí khác không hợp lệ.');
      }
      return { name, amount, employeeId: employeeId ? Number(employeeId) : null };
    })
    .filter(Boolean);
}

function fuelHistoryFilters(query) {
  const from = String(query.from ?? '').trim();
  const to = String(query.to ?? '').trim();
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    throw badRequest('Vui lòng chọn khoảng ngày hợp lệ.');
  }
  const fuelType = String(query.fuelType ?? '')
    .trim()
    .slice(0, 100);
  const employeeId = String(query.employeeId ?? '').trim();
  if (employeeId && (!Number.isInteger(Number(employeeId)) || Number(employeeId) < 1)) {
    throw badRequest('Nhân viên không hợp lệ.');
  }
  const pagination = String(query.pagination ?? '1') !== '0';
  const limit = Number(query.limit ?? 20);
  const offset = Number(query.offset ?? 0);
  if (
    pagination &&
    (!Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0)
  ) {
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
  const where = ["status = 'active'", 'period_from >= ?', 'period_to <= ?'];
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
    db.prepare(`SELECT COUNT(*) AS count FROM fuel_records f WHERE ${whereSql}`).get(...params)
      .count,
  );
  const summary = db
    .prepare(
      `SELECT COALESCE(SUM(f.distance_km), 0) AS distance_km,
            COALESCE(SUM(f.total_fee), 0) AS total_fee
       FROM fuel_records f
      WHERE ${whereSql}`,
    )
    .get(...params);
  const rows = db
    .prepare(
      `SELECT f.*, e.full_name AS employee_name
       FROM fuel_records f LEFT JOIN employees e ON e.id = f.employee_id
       WHERE ${whereSql}
       ORDER BY f.period_to DESC, f.id DESC${input.limit === null ? '' : ' LIMIT ? OFFSET ?'}`,
    )
    .all(...params, ...(input.limit === null ? [] : [input.limit, input.offset]));
  const legsByRecordId = new Map();
  if (rows.length) {
    const recordIds = rows.map((row) => row.id);
    const placeholders = recordIds.map(() => '?').join(', ');
    const legs = db
      .prepare(
        `SELECT fuel_record_id, sequence_no, from_name, to_name, distance_km
         FROM fuel_record_legs
        WHERE fuel_record_id IN (${placeholders})
        ORDER BY fuel_record_id, sequence_no`,
      )
      .all(...recordIds);
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
    vehicleType: row.vehicle_type || '',
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
    summary: {
      distanceKm: Number(summary.distance_km),
      totalFee: Number(summary.total_fee),
    },
    employees: db
      .prepare(
        'SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE',
      )
      .all()
      .map((row) => ({ id: Number(row.id), fullName: row.full_name })),
  };
}

function reportData(db, input) {
  const where = ['e.entry_date >= ?', 'e.entry_date <= ?'];
  const params = [input.from, input.to];
  if (input.employeeId) {
    where.push('e.employee_id = ?');
    params.push(input.employeeId);
  }
  const entries = db
    .prepare(
      `SELECT e.*,
            COALESCE((
              SELECT province_city FROM misa_rows
               WHERE customer_key = e.customer_key
                 AND province_city <> ''
               ORDER BY document_date DESC, id DESC LIMIT 1
            ), '') AS province_city,
            COALESCE((
              SELECT delivery_point FROM carriers
               WHERE id = e.carrier_id
            ), '') AS carrier_delivery_point,
            (
              SELECT r.transport_fee
                FROM carrier_customer_rates r
               WHERE r.customer_id = e.customer_id
                 AND r.carrier_id = e.carrier_id
                 AND (r.spec_key = e.spec_key OR r.is_default = 1)
               ORDER BY r.is_default ASC, r.id
               LIMIT 1
            ) AS standard_transport_fee
       FROM entries e
      WHERE ${where.join(' AND ')}
      ORDER BY e.entry_date ASC, e.id ASC`,
    )
    .all(...params);
  const fuelWhere = ["f.status = 'active'", 'f.period_from >= ?', 'f.period_to <= ?'];
  const fuelParams = [input.from, input.to];
  if (input.employeeId) {
    fuelWhere.push('f.employee_id = ?');
    fuelParams.push(input.employeeId);
  }
  const fuels = db
    .prepare(
      `SELECT f.*
       FROM fuel_records f
      WHERE ${fuelWhere.join(' AND ')}
      ORDER BY f.period_from ASC, f.id ASC`,
    )
    .all(...fuelParams);
  const fuelLegsByRecordId = new Map();
  if (fuels.length) {
    const fuelRecordIds = fuels.map((fuel) => fuel.id);
    const placeholders = fuelRecordIds.map(() => '?').join(', ');
    const fuelLegs = db
      .prepare(
        `SELECT fuel_record_id, sequence_no, from_name, to_name, distance_km
         FROM fuel_record_legs
        WHERE fuel_record_id IN (${placeholders})
        ORDER BY fuel_record_id, sequence_no`,
      )
      .all(...fuelRecordIds);
    fuelLegs.forEach((leg) => {
      const legs = fuelLegsByRecordId.get(leg.fuel_record_id) || [];
      legs.push({ from: leg.from_name, to: leg.to_name, km: Number(leg.distance_km) });
      fuelLegsByRecordId.set(leg.fuel_record_id, legs);
    });
  }
  const employees = db
    .prepare(
      'SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE',
    )
    .all();
  const company =
    db.prepare('SELECT company_name, company_address FROM app_settings WHERE id = 1').get() || {};
  return { entries, fuels, fuelLegsByRecordId, employees, company };
}

/** Nguồn dữ liệu chung của báo cáo chênh lệch: phiếu có cước khác giá thiết lập. */
const CARRIER_VARIANCE_PAGE_SIZE = 50;

function carrierVarianceSource(input) {
  const where = ['e.transport_fee <> r.transport_fee'];
  const params = [];
  if (!input.all) {
    where.unshift('e.entry_date >= ?', 'e.entry_date <= ?');
    params.push(input.from, input.to);
  }
  if (input.employeeId) {
    where.push('e.employee_id = ?');
    params.push(input.employeeId);
  }
  return {
    sql: `FROM entries e
     LEFT JOIN employees em ON em.id = e.employee_id
     INNER JOIN customers cu ON cu.id = e.customer_id
     INNER JOIN carriers ca ON ca.id = e.carrier_id
     INNER JOIN carrier_customer_rates r ON r.id = (
       SELECT id FROM carrier_customer_rates
        WHERE customer_id = cu.id AND carrier_id = ca.id
          AND (spec_key = e.spec_key OR is_default = 1)
        ORDER BY is_default ASC, id
        LIMIT 1
     )
     WHERE ${where.join(' AND ')}`,
    params,
  };
}

/**
 * Các dòng chênh lệch, sắp theo nhà xe → khách hàng → ngày. Có `page` thì chỉ
 * lấy một trang; tỉnh/thành (tra trong MISA) chỉ tính cho các dòng của trang đó.
 */
function carrierVariance(db, input, page = null) {
  const source = carrierVarianceSource(input);
  const paging = page ? 'LIMIT ? OFFSET ?' : '';
  return db
    .prepare(
      `WITH rows AS MATERIALIZED (
       SELECT e.id, e.entry_date, em.full_name AS employee_name,
         ca.name AS carrier, cu.customer_name AS customer, cu.customer_key,
         e.spec, r.transport_fee AS standard_fee, e.transport_fee AS actual_fee,
         e.transport_fee - r.transport_fee AS difference, e.rate_variance_note,
         ROW_NUMBER() OVER (
           ORDER BY ca.name COLLATE NOCASE, cu.customer_name COLLATE NOCASE, e.entry_date ASC, e.id ASC
         ) AS position
       ${source.sql}
       ORDER BY position
       ${paging}
     )
     SELECT rows.*, COALESCE((
         SELECT province_city FROM misa_rows
          WHERE misa_rows.customer_key = rows.customer_key AND province_city <> ''
          ORDER BY document_date DESC, id DESC LIMIT 1
       ), '') AS province_city
       FROM rows ORDER BY position`,
    )
    .all(...source.params, ...(page ? [page.limit, page.offset] : []))
    .map((row) => ({
      id: Number(row.id),
      employeeName: row.employee_name || '',
      carrier: row.carrier,
      customer: row.customer,
      entryDate: row.entry_date,
      provinceCity: row.province_city || '',
      spec: row.spec || '—',
      actualFee: Number(row.actual_fee),
      standardFee: Number(row.standard_fee),
      difference: Number(row.difference),
      varianceNote: entryVarianceNote(row),
    }));
}

/** Số liệu tổng hợp trên toàn bộ kết quả lọc, không phụ thuộc trang đang xem. */
function carrierVarianceSummary(db, input) {
  const source = carrierVarianceSource(input);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS entries,
       COALESCE(SUM(e.transport_fee - r.transport_fee), 0) AS difference,
       COALESCE(SUM(e.transport_fee > r.transport_fee), 0) AS over_entries,
       COALESCE(SUM(CASE WHEN e.transport_fee > r.transport_fee
         THEN e.transport_fee - r.transport_fee ELSE 0 END), 0) AS over_amount,
       COALESCE(SUM(e.transport_fee < r.transport_fee), 0) AS under_entries,
       COALESCE(SUM(CASE WHEN e.transport_fee < r.transport_fee
         THEN r.transport_fee - e.transport_fee ELSE 0 END), 0) AS under_amount
     ${source.sql}`,
    )
    .get(...source.params);
  return {
    entries: Number(row.entries),
    difference: Number(row.difference),
    overEntries: Number(row.over_entries),
    overAmount: Number(row.over_amount),
    underEntries: Number(row.under_entries),
    underAmount: Number(row.under_amount),
  };
}

const formatDate = (value) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
const formatFileDate = (value) => `${value.slice(8, 10)}-${value.slice(5, 7)}-${value.slice(0, 4)}`;
const fileNamePart = (value) =>
  String(value || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const baseStyle = {
  font: { name: 'Times New Roman', sz: 11 },
  alignment: { vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  },
};
const centered = {
  ...baseStyle,
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
};
const money = {
  ...baseStyle,
  alignment: { horizontal: 'right', vertical: 'center' },
  numFmt: '#,##0',
};
const heading = { ...centered, font: { name: 'Times New Roman', sz: 11, bold: true } };
const DAILY_REPORT_HEADERS = [
  'STT',
  'Ngày',
  'Điểm đi',
  'Điểm đến',
  'Nhà xe',
  'Khách hàng',
  'Tỉnh/TP',
  'Sản phẩm',
  'Quy cách',
  'Giá cước',
  'Phí cổng',
  'Chênh lệch',
  'Bill',
  'Km',
  'Giá xăng',
  'Tiền xăng',
  'Chi phí khác',
  'Ghi chú',
];
const DAILY_REPORT_COLUMN_WIDTHS = [
  5.42578125, 13.57, 27.7109375, 27.7109375, 14.42578125, 32.5703125, 10.85546875, 28.42578125,
  10.28515625, 10.140625, 9.42578125, 11.85546875, 4.42578125, 7.42578125, 9.5703125, 10.7109375,
  11.7109375, 17.7109375,
];
const DAILY_REPORT_TEXT_WIDTHS = [
  4.71, 12.86, 27, 27, 13.71, 31.86, 10.14, 27.71, 9.57, 9.43, 8.71, 11.14, 3.71, 6.71, 8.86, 10,
  11, 17,
];
function set(ws, cell, value, style) {
  const type = typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's';
  ws[cell] = { t: type, v: value, s: style };
}
function merge(ws, range) {
  ws['!merges'] ??= [];
  ws['!merges'].push(XLSX.utils.decode_range(range));
}
function wrappedTextLineCount(value, columnWidth) {
  const charactersPerLine = Math.max(8, Math.floor(columnWidth - 2));
  return String(value || '')
    .split(/\r?\n/)
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}
function wrappedRowHeight(cells) {
  const height = cells.reduce((maximum, [value, width, rowSpan = 1]) => {
    const lines = wrappedTextLineCount(value, width);
    // Nội dung của ô gộp được trải trên tổng chiều cao các dòng trong vùng gộp.
    // Với ô thường, cộng khoảng đệm để ký tự có dấu không sát viền trên/dưới.
    const required = Math.ceil((lines * 15 + 4) / Math.max(1, rowSpan));
    return Math.max(maximum, required);
  }, 30);
  // 409 pt là giới hạn chiều cao một dòng của Excel.
  return Math.min(409, height);
}

function normalizeEmptyFills(archive) {
  let stylesXml = strFromU8(archive['xl/styles.xml']);
  stylesXml = stylesXml.replace(
    /<patternFill patternType="(none|gray125)"><bgColor\/><\/patternFill>/g,
    '<patternFill patternType="$1"/>',
  );
  archive['xl/styles.xml'] = strToU8(stylesXml);
}

/** Thiết lập in A4 và vừa một trang theo chiều ngang cho workbook báo cáo. */
function printWorkbookBase64(workbook, orientation) {
  const archive = unzipSync(
    XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }),
  );
  normalizeEmptyFills(archive);
  for (const path of Object.keys(archive)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    let xml = strFromU8(archive[path]);
    if (!/<sheetPr\b/.test(xml)) {
      xml = xml.replace(
        /(<worksheet\b[^>]*>)/,
        '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
      );
    } else if (!/<pageSetUpPr\b/.test(xml)) {
      xml = xml.replace(/<sheetPr([^>]*)\/>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>');
    }
    xml = xml.replace(/<pageMargins\b[^>]*\/>/g, '');
    xml = xml.replace(/<pageSetup\b[^>]*\/>/g, '');
    // xlsx-js-style places this optional warning block after page settings.
    // Removing it keeps the worksheet child order strictly compatible with Excel.
    xml = xml.replace(/<ignoredErrors\b[\s\S]*?<\/ignoredErrors>/g, '');
    const pageLayout =
      '<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.1" footer="0.1"/>' +
      `<pageSetup paperSize="9" orientation="${orientation}" fitToWidth="1" fitToHeight="0"/>`;
    xml = xml.replace('</worksheet>', `${pageLayout}</worksheet>`);
    archive[path] = strToU8(xml);
  }
  return Buffer.from(zipSync(archive, { level: 6 })).toString('base64');
}

function landscapeWorkbookBase64(workbook) {
  return printWorkbookBase64(workbook, 'landscape');
}

function portraitWorkbookBase64(workbook) {
  return printWorkbookBase64(workbook, 'portrait');
}

function fuelExtraCosts(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        name: String(item?.name ?? '').trim(),
        amount: number(item?.amount),
        legIndex: Number.isInteger(Number(item?.legIndex)) ? Number(item.legIndex) : 0,
      }))
      .filter((item) => item.name && item.amount > 0 && item.legIndex >= 0);
  } catch {
    return [];
  }
}

function fuelBaseFee(record) {
  const baseKm = number(record.consumption_base_km);
  return baseKm
    ? Math.round(
        (number(record.distance_km) *
          number(record.consumption_liters) *
          number(record.fuel_price)) /
          baseKm,
      )
    : number(record.total_fee);
}

function employeeCosts(data, employeeId) {
  const rows = data.entries.filter((row) => row.employee_id === employeeId);
  const fuelRecords = data.fuels.filter((row) => row.employee_id === employeeId);
  const fuel = fuelRecords.reduce((sum, row) => sum + fuelBaseFee(row), 0);
  const fuelOther = fuelRecords.reduce(
    (sum, row) =>
      sum + fuelExtraCosts(row.extra_costs).reduce((costSum, item) => costSum + item.amount, 0),
    0,
  );
  const transport = rows.reduce((sum, row) => sum + number(row.transport_fee), 0);
  const gate = rows.reduce((sum, row) => sum + number(row.gate_fee), 0);
  const other = rows.reduce((sum, row) => sum + number(row.other_fee), 0);
  return {
    rows,
    transport,
    gate,
    other,
    fuelOther,
    fuel,
    total: transport + gate + other + fuelOther + fuel,
  };
}

/** Chuyển nguyên lưới ô của sheet Excel sang dữ liệu in, gồm cả vùng merge. */
function worksheetForPrint(ws, name) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const anchors = new Map();
  const covered = new Set();
  for (const mergeRange of ws['!merges'] || []) {
    anchors.set(`${mergeRange.s.r}:${mergeRange.s.c}`, mergeRange);
    for (let row = mergeRange.s.r; row <= mergeRange.e.r; row += 1) {
      for (let column = mergeRange.s.c; column <= mergeRange.e.c; column += 1) {
        if (row !== mergeRange.s.r || column !== mergeRange.s.c) {
          covered.add(`${row}:${column}`);
        }
      }
    }
  }
  const rows = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const cells = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const coordinate = `${row}:${column}`;
      if (covered.has(coordinate)) continue;
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const source = ws[address];
      const mergeRange = anchors.get(coordinate);
      const style = source?.s || {};
      const numberFormat = style.numFmt;
      const decimalPlaces =
        typeof numberFormat === 'string' && /^#,##0(?:\.0+)?$/.test(numberFormat)
          ? numberFormat.split('.')[1]?.length || 0
          : null;
      const value =
        source?.v == null
          ? ''
          : typeof source.v === 'number' && decimalPlaces !== null
            ? new Intl.NumberFormat('vi-VN', {
                minimumFractionDigits: decimalPlaces,
                maximumFractionDigits: decimalPlaces,
              }).format(source.v)
            : XLSX.utils.format_cell(source);
      cells.push({
        address,
        value,
        rowSpan: mergeRange ? mergeRange.e.r - row + 1 : 1,
        colSpan: mergeRange ? mergeRange.e.c - column + 1 : 1,
        align: style.alignment?.horizontal || 'left',
        bold: Boolean(style.font?.bold),
        italic: Boolean(style.font?.italic),
        color: style.font?.color?.rgb || '',
        border: Boolean(style.border),
      });
    }
    rows.push({ number: row + 1, cells });
  }
  return {
    name,
    columnWidths: (ws['!cols'] || []).map((column) => Number(column.width || column.wch || 10)),
    rows,
  };
}

function deliveryRows(entries) {
  const rows = [];
  let dayNumber = 0;
  for (let offset = 0; offset < entries.length; ) {
    const entryDate = entries[offset].entry_date;
    const group = [];
    while (offset < entries.length && entries[offset].entry_date === entryDate) {
      group.push(entries[offset]);
      offset += 1;
    }
    dayNumber += 1;
    const carrierGroups = new Map();
    group.forEach((entry) => {
      const key = String(entry.carrier || '')
        .trim()
        .toLowerCase();
      const carrierEntries = carrierGroups.get(key) || [];
      carrierEntries.push(entry);
      carrierGroups.set(key, carrierEntries);
    });
    let dayIndex = 0;
    const dayRows = [];
    carrierGroups.forEach((carrierEntries) => {
      const carrierNote = carrierExportNote(carrierEntries);
      const carrierBillStatuses = new Set(
        carrierEntries.map((entry) => String(entry.bill_status ?? '')),
      );
      // Chỉ gộp Bill khi toàn bộ phiếu của cùng nhà xe có chung trạng thái.
      // Nếu trộn Có bill/Không bill thì mỗi phiếu phải giữ trạng thái riêng,
      // nếu không sẽ che mất chứng từ cần theo dõi.
      const hasUniformCarrierBill = carrierBillStatuses.size === 1;
      const carrierBillStatus = hasUniformCarrierBill ? carrierEntries[0].bill_status : null;
      carrierEntries.forEach((entry, carrierIndex) => {
        dayRows.push({
          entry,
          dayNumber: dayIndex === 0 ? dayNumber : null,
          entryDate: dayIndex === 0 ? formatDate(entryDate) : null,
          entryDateIso: entryDate,
          carrier: carrierIndex === 0 ? entry.carrier : null,
          carrierNote: carrierIndex === 0 ? carrierNote : null,
          carrierHasNote: Boolean(carrierNote),
          billStatus: hasUniformCarrierBill
            ? carrierIndex === 0
              ? carrierBillStatus
              : null
            : entry.bill_status,
          groupSize: group.length,
          isGroupStart: dayIndex === 0,
          carrierGroupSize: carrierEntries.length,
          isCarrierGroupStart: carrierIndex === 0,
          mergeCarrier: carrierEntries.length > 1 && carrierIndex === 0,
          mergeCarrierBill:
            carrierEntries.length > 1 && hasUniformCarrierBill && carrierIndex === 0,
        });
        dayIndex += 1;
      });
    });
    for (let rowIndex = 0; rowIndex < dayRows.length; ) {
      const carrierRow = dayRows[rowIndex];
      if (carrierRow.carrierHasNote) {
        carrierRow.noteValue = carrierRow.carrierNote;
        carrierRow.noteSpan = carrierRow.carrierGroupSize;
        rowIndex += carrierRow.carrierGroupSize;
        continue;
      }
      const segmentStart = rowIndex;
      let segmentSize = 0;
      while (rowIndex < dayRows.length && !dayRows[rowIndex].carrierHasNote) {
        segmentSize += dayRows[rowIndex].carrierGroupSize;
        rowIndex += dayRows[rowIndex].carrierGroupSize;
      }
      dayRows[segmentStart].noteValue = '';
      dayRows[segmentStart].noteSpan = segmentSize;
    }
    rows.push(...dayRows);
  }
  return rows;
}

function fuelSummaryRows(data, employeeId) {
  return data.fuels
    .filter((record) => record.employee_id === employeeId)
    .map((record) => {
      const extraCosts = fuelExtraCosts(record.extra_costs);
      const legs = data.fuelLegsByRecordId.get(record.id) || [];
      return {
        periodFrom: record.period_from,
        periodTo: record.period_to,
        distanceKm: number(record.distance_km),
        fuelPrice: number(record.fuel_price),
        totalFee: fuelBaseFee(record),
        extraCosts,
        legs: legs.map((leg, index) => ({
          ...leg,
          extraCosts: extraCosts.filter((item) => item.legIndex === index),
        })),
      };
    });
}

function routeDestinationCarrierKey(value) {
  return normalizeSearchText(String(value || '').split(',', 1)[0]);
}

function deliveryRouteKey(delivery) {
  return routeDestinationCarrierKey(
    delivery.entry.carrier_delivery_point || delivery.entry.carrier,
  );
}

function dailyDetailRows(deliveries, fuels) {
  const remainingFuels = [...fuels];
  const rows = [];
  let nextDayNumber = deliveries.reduce(
    (largest, delivery) => Math.max(largest, number(delivery.dayNumber)),
    0,
  );
  for (let offset = 0; offset < deliveries.length; ) {
    const firstDelivery = deliveries[offset];
    const groupSize = firstDelivery.isGroupStart ? firstDelivery.groupSize : 1;
    const group = deliveries.slice(offset, offset + groupSize);
    offset += group.length;
    const date = firstDelivery.entryDateIso;
    let fuelIndex = remainingFuels.findIndex(
      (fuelRow) => fuelRow.periodFrom === date && fuelRow.periodTo === date,
    );
    if (fuelIndex < 0) {
      fuelIndex = remainingFuels.findIndex(
        (fuelRow) => fuelRow.periodFrom <= date && fuelRow.periodTo >= date,
      );
    }
    const fuelRow = fuelIndex < 0 ? null : remainingFuels.splice(fuelIndex, 1)[0];
    const legs = fuelRow?.legs?.length
      ? fuelRow.legs
      : fuelRow
        ? [
            {
              from: 'Chưa lưu chi tiết lộ trình',
              to: '',
              km: fuelRow.distanceKm,
              extraCosts: fuelRow.extraCosts || [],
            },
          ]
        : [];
    const unmatchedDeliveries = new Set(group);
    const dayRows = [];
    legs.forEach((fuelLeg) => {
      const carrierKey = routeDestinationCarrierKey(fuelLeg.to);
      const matches = carrierKey
        ? group.filter(
            (delivery) =>
              unmatchedDeliveries.has(delivery) && deliveryRouteKey(delivery) === carrierKey,
          )
        : [];
      const matchedDeliveries = matches.length ? matches : [null];
      matchedDeliveries.forEach((delivery, matchIndex) => {
        if (delivery) unmatchedDeliveries.delete(delivery);
        dayRows.push({
          delivery,
          fuelLeg: matchIndex === 0 ? fuelLeg : null,
          fuelLegSpan: matchedDeliveries.length,
        });
      });
    });
    group.forEach((delivery) => {
      if (unmatchedDeliveries.has(delivery)) {
        dayRows.push({ delivery, fuelLeg: null, fuelLegSpan: 1 });
      }
    });
    if (!dayRows.length) dayRows.push({ delivery: null, fuelLeg: null, fuelLegSpan: 1 });
    dayRows.forEach((row, index) => {
      rows.push({
        ...row,
        fuelRow: index === 0 ? fuelRow : null,
        fuelSpan: fuelRow ? dayRows.length : 1,
        dayNumber: index === 0 ? firstDelivery.dayNumber : null,
        entryDate: index === 0 ? firstDelivery.entryDate : null,
        daySpan: index === 0 ? dayRows.length : null,
      });
    });
  }
  remainingFuels.forEach((fuelRow) => {
    nextDayNumber += 1;
    const fuelDate = formatDate(fuelRow.periodFrom);
    const legs = fuelRow.legs?.length
      ? fuelRow.legs
      : [
          {
            from: 'Chưa lưu chi tiết lộ trình',
            to: '',
            km: fuelRow.distanceKm,
            extraCosts: fuelRow.extraCosts || [],
          },
        ];
    legs.forEach((fuelLeg, index) => {
      rows.push({
        delivery: null,
        fuelLeg,
        fuelLegSpan: 1,
        fuelRow: index === 0 ? fuelRow : null,
        fuelSpan: legs.length,
        dayNumber: index === 0 ? nextDayNumber : null,
        entryDate: index === 0 ? fuelDate : null,
        daySpan: index === 0 ? legs.length : null,
      });
    });
  });
  return rows.length ? rows : [{ delivery: null, fuelRow: null, fuelSpan: 1 }];
}

function billStatusValue(status) {
  if (status === 'Có bill') return '☑';
  if (status === 'Không bill') return '☐';
  return null;
}

function dailySheet(data, input, employee, extras) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const {
    rows: entries,
    transport,
    gate,
    other,
    fuelOther,
    fuel,
    total,
  } = employeeCosts(data, employee.id);
  const deliveries = deliveryRows(entries);
  const fuels = fuelSummaryRows(data, employee.id);
  const details = dailyDetailRows(deliveries, fuels);
  const companyName = data.company.company_name || 'CÔNG TY';
  const companyAddress = data.company.company_address || '';
  const dailyBaseStyle = { ...baseStyle, font: { name: 'Times New Roman', sz: 12 } };
  const dailyCentered = {
    ...dailyBaseStyle,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };
  const dailyBillCheckbox = {
    ...dailyCentered,
    font: { name: 'Segoe UI Symbol', sz: 14, bold: true },
  };
  const dailyMoney = {
    ...dailyBaseStyle,
    alignment: { horizontal: 'center', vertical: 'center' },
    numFmt: '#,##0',
  };
  const dailyIncreasedPrice = {
    ...dailyMoney,
    font: { name: 'Times New Roman', sz: 12, bold: true, color: { rgb: 'FF0000' } },
  };
  const dailyDecreasedPrice = {
    ...dailyMoney,
    font: { name: 'Times New Roman', sz: 12, bold: true, color: { rgb: '00682F' } },
  };
  const dailyHeading = { ...dailyCentered, font: { name: 'Times New Roman', sz: 12, bold: true } };
  ws['!cols'] = DAILY_REPORT_COLUMN_WIDTHS.map((width) => ({ width }));
  set(ws, 'A1', companyName, {
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  });
  merge(ws, 'A1:D2');
  set(ws, 'N1', 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', {
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'N1:R1');
  set(ws, 'N2', 'Độc lập - Tự do - Hạnh phúc', {
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'N2:R2');
  set(ws, 'A4', 'BẢNG CHI TIẾT CƯỚC NHÂN VIÊN', {
    font: { name: 'Times New Roman', sz: 18, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A4:R4');
  set(ws, 'A5', `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, {
    font: { name: 'Times New Roman', sz: 12, italic: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A5:R5');
  const companyInfo = { font: { name: 'Times New Roman', sz: 12 } };
  set(ws, 'A7', `Đơn vị: ${companyName}`, companyInfo);
  merge(ws, 'A7:R7');
  set(ws, 'A8', `Địa chỉ: ${companyAddress}`, companyInfo);
  merge(ws, 'A8:R8');
  set(ws, 'A9', `Nhân viên phụ trách: ${employee.full_name}`, companyInfo);
  merge(ws, 'A9:R9');
  DAILY_REPORT_HEADERS.forEach((value, index) => {
    set(ws, XLSX.utils.encode_cell({ r: 10, c: index }), value, dailyHeading);
  });

  const detailRows = details.length;
  const detailStartRow = 12;
  const fuelDistance = { ...dailyCentered, numFmt: '#,##0.0' };
  const detailExtras = [];
  for (let index = 0; index < detailRows; index += 1) {
    const excelRow = detailStartRow + index;
    const { delivery, fuelLeg, fuelLegSpan, fuelRow, fuelSpan, dayNumber, entryDate, daySpan } =
      details[index];
    for (let column = 0; column < DAILY_REPORT_HEADERS.length; column += 1) {
      set(ws, XLSX.utils.encode_cell({ r: excelRow - 1, c: column }), '', dailyBaseStyle);
    }
    if (dayNumber != null) set(ws, `A${excelRow}`, dayNumber, dailyCentered);
    if (entryDate != null) set(ws, `B${excelRow}`, entryDate, dailyCentered);
    if (daySpan > 1) {
      const lastExcelRow = excelRow + daySpan - 1;
      merge(ws, `A${excelRow}:A${lastExcelRow}`);
      merge(ws, `B${excelRow}:B${lastExcelRow}`);
    }
    if (delivery) {
      const { entry } = delivery;
      const priceDifference =
        entry.standard_transport_fee == null
          ? null
          : number(entry.transport_fee) - number(entry.standard_transport_fee);
      const bill = billStatusValue(delivery.billStatus);
      const gateFee = number(entry.gate_fee);
      const displayDifference =
        priceDifference == null || priceDifference === 0 ? '-' : priceDifference;
      const values = [
        delivery.carrier || '',
        entry.customer,
        entry.province_city || '',
        entry.note || '',
        entry.spec,
        number(entry.transport_fee),
        gateFee === 0 ? '-' : gateFee,
        displayDifference,
        bill,
      ];
      values.forEach((value, column) => {
        if (value === null) return;
        const targetColumn = column + 4;
        const style =
          targetColumn === 11 && value > 0
            ? dailyIncreasedPrice
            : targetColumn === 11 && value < 0
              ? dailyDecreasedPrice
              : [9, 10, 11].includes(targetColumn)
                ? dailyMoney
                : targetColumn === 12
                  ? dailyBillCheckbox
                  : [0, 1, 4, 6, 8].includes(targetColumn)
                    ? dailyCentered
                    : dailyBaseStyle;
        set(ws, XLSX.utils.encode_cell({ r: excelRow - 1, c: targetColumn }), value, style);
      });
      if (delivery.mergeCarrier) {
        const lastExcelRow = excelRow + delivery.carrierGroupSize - 1;
        merge(ws, `E${excelRow}:E${lastExcelRow}`);
      }
      if (delivery.mergeCarrierBill) {
        const lastExcelRow = excelRow + delivery.carrierGroupSize - 1;
        merge(ws, `M${excelRow}:M${lastExcelRow}`);
      }
    }
    if (fuelLeg) {
      set(ws, `C${excelRow}`, fuelLeg.from || '—', dailyBaseStyle);
      set(ws, `D${excelRow}`, fuelLeg.to || '—', dailyBaseStyle);
      set(ws, `N${excelRow}`, number(fuelLeg.km), fuelDistance);
      if (fuelLegSpan > 1) {
        const lastExcelRow = excelRow + fuelLegSpan - 1;
        for (const column of ['C', 'D', 'N']) {
          merge(ws, `${column}${excelRow}:${column}${lastExcelRow}`);
        }
      }
      if (!delivery) {
        for (const column of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
          set(ws, `${column}${excelRow}`, '-', dailyCentered);
        }
      }
    }
    if (fuelRow) {
      set(ws, `O${excelRow}`, fuelRow.fuelPrice, dailyMoney);
      set(ws, `P${excelRow}`, fuelRow.totalFee, dailyMoney);
      if (fuelSpan > 1) {
        const lastExcelRow = excelRow + fuelSpan - 1;
        for (const column of ['O', 'P']) {
          merge(ws, `${column}${excelRow}:${column}${lastExcelRow}`);
        }
      }
    }
    const routeExtraCosts = fuelLeg?.extraCosts || [];
    const routeExtraCost = routeExtraCosts.reduce((sum, item) => sum + number(item.amount), 0);
    const routeExtraNote = routeExtraCosts
      .map((item) => item.name)
      .filter(Boolean)
      .join(' / ');
    const entryExtraCost = number(delivery?.entry.other_fee);
    const entryExtraNote = String(delivery?.entry.other_fee_name ?? '').trim();
    const totalExtraCost = routeExtraCost + entryExtraCost;
    set(ws, `Q${excelRow}`, totalExtraCost || '-', totalExtraCost ? dailyMoney : dailyCentered);
    const finalNote = [delivery?.noteValue, entryExtraNote, routeExtraNote]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(' / ');
    detailExtras[index] = { totalExtraCost, finalNote };
    set(ws, `R${excelRow}`, finalNote || '-', dailyCentered);
    ws['!rows'] ??= [];
    ws['!rows'][excelRow - 1] = {
      hpt: wrappedRowHeight([
        [fuelLeg?.from, DAILY_REPORT_TEXT_WIDTHS[2], fuelLegSpan],
        [fuelLeg?.to, DAILY_REPORT_TEXT_WIDTHS[3], fuelLegSpan],
        [
          delivery?.entry.carrier,
          DAILY_REPORT_TEXT_WIDTHS[4],
          delivery?.mergeCarrierBill ? delivery.carrierGroupSize : 1,
        ],
        [delivery?.entry.customer, DAILY_REPORT_TEXT_WIDTHS[5]],
        [delivery?.entry.province_city, DAILY_REPORT_TEXT_WIDTHS[6]],
        [delivery?.entry.note, DAILY_REPORT_TEXT_WIDTHS[7]],
        [delivery?.entry.spec, DAILY_REPORT_TEXT_WIDTHS[8]],
        [finalNote, DAILY_REPORT_TEXT_WIDTHS[17]],
      ]),
    };
  }
  details.forEach((detail, index) => {
    const delivery = detail.delivery;
    if (!delivery?.mergeCarrier) return;
    const groupSize = delivery.carrierGroupSize;
    const groupExtras = detailExtras.slice(index, index + groupSize);
    const totalExtraCost = groupExtras.reduce((sum, item) => sum + item.totalExtraCost, 0);
    const finalNote = groupExtras
      .map((item) => item.finalNote)
      .filter(Boolean)
      .filter((value, noteIndex, values) => values.indexOf(value) === noteIndex)
      .join(' / ');
    const startRow = detailStartRow + index;
    const lastRow = startRow + groupSize - 1;
    set(ws, `Q${startRow}`, totalExtraCost || '-', totalExtraCost ? dailyMoney : dailyCentered);
    set(ws, `R${startRow}`, finalNote || '-', dailyCentered);
    merge(ws, `Q${startRow}:Q${lastRow}`);
    merge(ws, `R${startRow}:R${lastRow}`);
  });
  const summaryRow = detailStartRow + detailRows + 1;
  const summaryLabel = {
    ...dailyBaseStyle,
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
  };
  const summaryMoney = {
    ...dailyBaseStyle,
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '#,##0',
  };
  const addSummary = (row, label, value, emphasized = false) => {
    set(ws, `A${row}`, label, summaryLabel);
    set(ws, `B${row}`, '', summaryLabel);
    merge(ws, `A${row}:B${row}`);
    const valueStyle = emphasized
      ? { ...summaryMoney, font: { name: 'Times New Roman', sz: 12, bold: true } }
      : summaryMoney;
    set(ws, `C${row}`, value, valueStyle);
  };
  addSummary(summaryRow, 'Cước vận chuyển', transport);
  addSummary(summaryRow + 1, 'Phí vào cổng', gate);
  const otherTotal = other + fuelOther;
  const otherRowOffset = otherTotal > 0 ? 1 : 0;
  addSummary(summaryRow + 2, 'Tiền xăng', fuel);
  if (otherRowOffset) addSummary(summaryRow + 3, 'Chi phí khác', otherTotal);
  extras.forEach((extra, index) => {
    const row = summaryRow + 3 + otherRowOffset + index;
    addSummary(row, extra.name, extra.amount);
  });
  const grandTotalRow = summaryRow + 3 + otherRowOffset + extras.length;
  const extraTotal = extras.reduce((sum, item) => sum + item.amount, 0);
  addSummary(grandTotalRow, 'TỔNG TIỀN', total + extraTotal, true);
  const signDateRow = grandTotalRow + 2;
  const signRow = grandTotalRow + 3;
  const signature = {
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  set(ws, `P${signDateRow}`, 'Ngày… tháng…năm….', {
    font: { name: 'Times New Roman', sz: 12, italic: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  });
  merge(ws, `P${signDateRow}:R${signDateRow}`);
  set(ws, `A${signRow}`, 'Giám Đốc Duyệt', signature);
  merge(ws, `A${signRow}:C${signRow}`);
  set(ws, `F${signRow}`, 'Kế Toán Trưởng', signature);
  set(ws, `G${signRow}`, '', signature);
  set(ws, `H${signRow}`, '', signature);
  set(ws, `I${signRow}`, '', signature);
  merge(ws, `F${signRow}:I${signRow}`);
  set(ws, `P${signRow}`, 'Người lập', signature);
  merge(ws, `P${signRow}:R${signRow}`);
  ws['!rows'] ??= [];
  ws['!rows'][0] = { hpt: 18 };
  ws['!rows'][1] = { hpt: 18 };
  ws['!rows'][3] = { hpt: 25.5 };
  ws['!rows'][10] = { hpt: 34 };
  ws['!ref'] = `A1:R${signRow}`;
  return ws;
}

function dailySummarySheet(data, input, employees, extras) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const summaryBaseStyle = { ...baseStyle, font: { name: 'Times New Roman', sz: 12 } };
  const summaryCentered = {
    ...summaryBaseStyle,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };
  const summaryMoney = {
    ...summaryBaseStyle,
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '#,##0',
  };
  const summaryHeading = {
    ...summaryCentered,
    font: { name: 'Times New Roman', sz: 12, bold: true },
  };
  const companyName = data.company.company_name || 'CÔNG TY';
  const companyAddress = data.company.company_address || '';
  const rows = employees.map((employee) => ({
    employee,
    ...employeeCosts(data, employee.id),
    extra: extras
      .filter((item) => item.employeeId === employee.id)
      .reduce((sum, item) => sum + item.amount, 0),
  }));
  rows.forEach((row) => {
    row.totalPayment = row.total + row.extra;
  });
  ws['!cols'] = [
    { wch: 7.5 },
    { wch: 28 },
    { wch: 19 },
    { wch: 17 },
    { wch: 17 },
    { wch: 17 },
    { wch: 21 },
  ];
  set(ws, 'A1', companyName, {
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  });
  merge(ws, 'A1:C2');
  set(ws, 'E1', 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', {
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'E1:G1');
  set(ws, 'E2', 'Độc lập - Tự do - Hạnh phúc', {
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'E2:G2');
  set(ws, 'A4', 'BẢNG TỔNG HỢP CƯỚC NHÂN VIÊN', {
    font: { name: 'Times New Roman', sz: 18, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A4:G4');
  set(ws, 'A5', `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, {
    font: { name: 'Times New Roman', sz: 12, italic: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A5:G5');
  const companyInfo = { font: { name: 'Times New Roman', sz: 12 } };
  set(ws, 'A7', `Đơn vị: ${companyName}`, companyInfo);
  merge(ws, 'A7:G7');
  set(ws, 'A8', `Địa chỉ: ${companyAddress}`, companyInfo);
  merge(ws, 'A8:G8');
  [
    'STT',
    'Nhân viên',
    'Cước vận chuyển',
    'Phí vào cổng',
    'Tiền xăng',
    'Chi phí khác',
    'Tổng cộng',
  ].forEach((value, index) => {
    set(ws, XLSX.utils.encode_cell({ r: 9, c: index }), value, summaryHeading);
  });
  rows.forEach((row, index) => {
    const values = [
      index + 1,
      row.employee.full_name,
      row.transport,
      row.gate,
      row.fuel,
      row.other + row.fuelOther + row.extra,
      row.totalPayment,
    ];
    values.forEach((value, column) => {
      set(
        ws,
        XLSX.utils.encode_cell({ r: 10 + index, c: column }),
        value,
        column === 0 ? summaryCentered : column === 1 ? summaryBaseStyle : summaryMoney,
      );
    });
  });
  const totalRow = 10 + rows.length;
  const totals = rows.reduce(
    (sum, row) => ({
      transport: sum.transport + row.transport,
      gate: sum.gate + row.gate,
      fuel: sum.fuel + row.fuel,
      extra: sum.extra + row.other + row.fuelOther + row.extra,
      total: sum.total + row.totalPayment,
    }),
    { transport: 0, gate: 0, fuel: 0, extra: 0, total: 0 },
  );
  const totalStyle = {
    ...summaryHeading,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };
  set(ws, XLSX.utils.encode_cell({ r: totalRow, c: 0 }), 'TỔNG CỘNG', totalStyle);
  set(ws, XLSX.utils.encode_cell({ r: totalRow, c: 1 }), '', totalStyle);
  merge(ws, `A${totalRow + 1}:B${totalRow + 1}`);
  [totals.transport, totals.gate, totals.fuel, totals.extra, totals.total].forEach(
    (value, index) => {
      set(ws, XLSX.utils.encode_cell({ r: totalRow, c: index + 2 }), value, {
        ...summaryMoney,
        font: { name: 'Times New Roman', sz: 12, bold: true },
      });
    },
  );
  const grandTotalRow = totalRow + 2;
  set(ws, XLSX.utils.encode_cell({ r: grandTotalRow, c: 4 }), 'TỔNG THANH TOÁN', totalStyle);
  set(ws, XLSX.utils.encode_cell({ r: grandTotalRow, c: 5 }), '', totalStyle);
  merge(ws, `E${grandTotalRow + 1}:F${grandTotalRow + 1}`);
  set(ws, XLSX.utils.encode_cell({ r: grandTotalRow, c: 6 }), totals.total, {
    ...summaryMoney,
    font: { name: 'Times New Roman', sz: 12, bold: true },
  });
  ws['!rows'] = [{ hpt: 18 }, { hpt: 18 }, {}, { hpt: 24 }];
  ws['!ref'] = `A1:G${grandTotalRow + 1}`;
  return ws;
}

function fuelHistorySheet(items, input, employeeName, company) {
  const orderedItems = [...items].sort(
    (left, right) =>
      left.periodFrom.localeCompare(right.periodFrom) ||
      left.periodTo.localeCompare(right.periodTo) ||
      left.id - right.id,
  );
  const ws = XLSX.utils.aoa_to_sheet([]);
  const whiteFill = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } };
  const fuelBaseStyle = { ...baseStyle, font: { name: 'Times New Roman', sz: 12 } };
  const metaStyle = {
    font: { name: 'Times New Roman', sz: 12 },
    alignment: { vertical: 'center' },
  };
  const centerStyle = {
    ...fuelBaseStyle,
    fill: whiteFill,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };
  const headerStyle = { ...centerStyle, font: { name: 'Times New Roman', sz: 12, bold: true } };
  const routeStyle = {
    ...fuelBaseStyle,
    fill: whiteFill,
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
  };
  const distanceStyle = { ...centerStyle, numFmt: '#,##0.0' };
  const totalStyle = { ...centerStyle, numFmt: '#,##0' };
  ws['!cols'] = [
    // Giữ tỷ lệ cột của mẫu in: lộ trình được tách thành điểm đi/điểm đến.
    { wch: 8 },
    { wch: 22 },
    { wch: 36 },
    { wch: 36 },
    { wch: 15 },
    { wch: 16 },
    { wch: 16 },
    { wch: 17 },
  ];
  set(ws, 'A1', 'BẢNG THỐNG KÊ TIỀN XĂNG', {
    font: { name: 'Times New Roman', sz: 18, bold: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  });
  merge(ws, 'A1:H1');
  set(ws, 'A2', `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`, {
    font: { name: 'Times New Roman', sz: 12, italic: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  });
  merge(ws, 'A2:H2');
  set(ws, 'A4', `Đơn vị: ${company.company_name || ''}`, metaStyle);
  set(ws, 'A5', `Địa chỉ: ${company.company_address || ''}`, metaStyle);
  set(ws, 'A6', `Nhân viên: ${employeeName}`, metaStyle);
  ['STT', 'Kỳ tính', 'Điểm đi', 'Điểm đến', 'Phương tiện', 'Km', 'Giá xăng', 'Tổng tiền'].forEach(
    (value, index) => {
      set(ws, XLSX.utils.encode_cell({ r: 7, c: index }), value, headerStyle);
    },
  );

  let row = 8;
  orderedItems.forEach((item, index) => {
    const legs = item.legs.length
      ? item.legs
      : [{ from: 'Chưa lưu chi tiết lộ trình', to: '', km: item.distanceKm }];
    const lastRow = row + legs.length - 1;
    legs.forEach((leg, legIndex) => {
      const excelRow = row + legIndex;
      set(
        ws,
        XLSX.utils.encode_cell({ r: excelRow, c: 0 }),
        legIndex ? '' : index + 1,
        centerStyle,
      );
      set(
        ws,
        XLSX.utils.encode_cell({ r: excelRow, c: 1 }),
        legIndex ? '' : `${formatDate(item.periodFrom)} - ${formatDate(item.periodTo)}`,
        centerStyle,
      );
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 2 }), leg.from || '—', routeStyle);
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 3 }), leg.to || '—', routeStyle);
      set(
        ws,
        XLSX.utils.encode_cell({ r: excelRow, c: 4 }),
        item.vehicleType === 'motorcycle'
          ? 'Xe máy'
          : item.vehicleType === 'truck'
            ? 'Ô tô'
            : 'Chưa ghi nhận',
        centerStyle,
      );
      set(ws, XLSX.utils.encode_cell({ r: excelRow, c: 5 }), Number(leg.km), distanceStyle);
      set(
        ws,
        XLSX.utils.encode_cell({ r: excelRow, c: 6 }),
        legIndex ? '' : item.fuelPrice,
        totalStyle,
      );
      set(
        ws,
        XLSX.utils.encode_cell({ r: excelRow, c: 7 }),
        legIndex ? '' : item.totalFee,
        totalStyle,
      );
      ws['!rows'] ??= [];
      ws['!rows'][excelRow] = {
        hpt: wrappedRowHeight([
          [leg.from, 30],
          [leg.to, 30],
        ]),
      };
    });
    if (legs.length > 1) {
      for (const column of ['A', 'B', 'G', 'H'])
        merge(ws, `${column}${row + 1}:${column}${lastRow + 1}`);
    }
    row = lastRow + 1;
  });
  const summaryRow = row + 1;
  const totalDistance = orderedItems.reduce((sum, item) => sum + number(item.distanceKm), 0);
  const totalFuelFee = orderedItems.reduce((sum, item) => sum + number(item.totalFee), 0);
  const summaryLabel = {
    ...fuelBaseStyle,
    fill: whiteFill,
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'left', vertical: 'center' },
  };
  const summaryDistanceStyle = {
    ...distanceStyle,
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'right', vertical: 'center' },
  };
  const summaryTotalStyle = {
    ...totalStyle,
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'right', vertical: 'center' },
  };
  set(ws, `D${summaryRow + 1}`, 'Tổng quãng đường', summaryLabel);
  set(ws, `E${summaryRow + 1}`, totalDistance, summaryDistanceStyle);
  set(ws, `D${summaryRow + 2}`, 'Tổng tiền xăng', summaryLabel);
  set(ws, `E${summaryRow + 2}`, totalFuelFee, summaryTotalStyle);
  const signatureDateRow = summaryRow + 3;
  const signatureTitleRow = summaryRow + 4;
  const signatureDateStyle = {
    font: { name: 'Times New Roman', sz: 12, italic: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  const signatureTitleStyle = {
    font: { name: 'Times New Roman', sz: 12, bold: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  set(ws, `G${signatureDateRow + 1}`, 'Ngày…..tháng…..năm….', signatureDateStyle);
  set(ws, `H${signatureDateRow + 1}`, '', signatureDateStyle);
  merge(ws, `G${signatureDateRow + 1}:H${signatureDateRow + 1}`);
  set(ws, `A${signatureTitleRow + 1}`, 'Giám Đốc', signatureTitleStyle);
  set(ws, `B${signatureTitleRow + 1}`, '', signatureTitleStyle);
  merge(ws, `A${signatureTitleRow + 1}:B${signatureTitleRow + 1}`);
  set(ws, `D${signatureTitleRow + 1}`, 'Kế Toán Trưởng', signatureTitleStyle);
  set(ws, `G${signatureTitleRow + 1}`, 'Người Lập', signatureTitleStyle);
  set(ws, `H${signatureTitleRow + 1}`, '', signatureTitleStyle);
  merge(ws, `G${signatureTitleRow + 1}:H${signatureTitleRow + 1}`);
  ws['!rows'] ??= [];
  ws['!rows'][0] = { hpt: 24 };
  ws['!rows'][7] = { hpt: 30 };
  ws['!rows'][signatureDateRow] = { hpt: 15 };
  ws['!rows'][signatureTitleRow] = { hpt: 15 };
  for (let index = 1; index <= 4; index += 1) {
    ws['!rows'][signatureTitleRow + index] = { hpt: 15 };
  }
  ws['!ref'] = `A1:H${signatureTitleRow + 5}`;
  return ws;
}

function uniqueSheetName(name, used) {
  const base =
    String(name || 'Chưa gán nhân viên')
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || 'Chưa gán nhân viên';
  const usedKeys = new Set([...used].map((value) => String(value).toLocaleLowerCase('vi-VN')));
  let candidate = base;
  let suffix = 2;
  while (usedKeys.has(candidate.toLocaleLowerCase('vi-VN'))) {
    const suffixText = ` (${suffix})`;
    candidate = `${base.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function validateExtraCostAssignments(extras, selectedEmployees, selectedEmployeeId) {
  const selectedIds = new Set(selectedEmployees.map((employee) => Number(employee.id)));
  if (selectedEmployeeId) {
    if (extras.some((item) => item.employeeId && item.employeeId !== selectedEmployeeId)) {
      throw badRequest('Chi phí khác không thuộc nhân viên đang xuất báo cáo.');
    }
    return;
  }
  if (extras.some((item) => !item.employeeId || !selectedIds.has(item.employeeId))) {
    throw badRequest('Vui lòng chọn nhân viên chịu phí cho từng chi phí khác.');
  }
}

function carrierVarianceSheet(items, input) {
  const ws = XLSX.utils.aoa_to_sheet([]);
  ws['!cols'] = [
    { wch: 7 },
    { wch: 14 },
    { wch: 25 },
    { wch: 22 },
    { wch: 32 },
    { wch: 18 },
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 46 },
  ];
  set(ws, 'A1', 'BÁO CÁO CHÊNH LỆCH CƯỚC NHÀ XE', {
    font: { name: 'Times New Roman', sz: 15, bold: true },
    alignment: { horizontal: 'center' },
  });
  merge(ws, 'A1:K1');
  set(
    ws,
    'A2',
    input.all
      ? 'Toàn bộ thời gian'
      : `Từ ngày ${formatDate(input.from)} đến ngày ${formatDate(input.to)}`,
    {
      font: { name: 'Times New Roman', sz: 11, italic: true },
      alignment: { horizontal: 'center' },
    },
  );
  merge(ws, 'A2:K2');
  [
    'STT',
    'Ngày',
    'Nhân viên',
    'Nhà xe',
    'Khách hàng',
    'Tỉnh/TP',
    'Quy cách',
    'Giá thiết lập',
    'Giá nhập',
    'Chênh lệch',
    'Ghi chú',
  ].forEach((value, index) => {
    set(ws, XLSX.utils.encode_cell({ r: 3, c: index }), value, heading);
  });
  items.forEach((item, index) => {
    const values = [
      index + 1,
      formatDate(item.entryDate),
      item.employeeName || 'Chưa gán',
      item.carrier,
      item.customer,
      item.provinceCity || '',
      item.spec,
      item.standardFee,
      item.actualFee,
      item.difference,
      item.varianceNote,
    ];
    values.forEach((value, column) => {
      set(
        ws,
        XLSX.utils.encode_cell({ r: 4 + index, c: column }),
        value,
        [0, 1, 2, 3, 5, 6].includes(column)
          ? centered
          : [7, 8, 9].includes(column)
            ? money
            : baseStyle,
      );
    });
  });
  const totalRow = 4 + items.length;
  const totalDifference = items.reduce((sum, item) => sum + item.difference, 0);
  const totalBorder = { ...baseStyle.border, bottom: { style: 'thin', color: { rgb: '000000' } } };
  const totalLabel = { ...heading, border: totalBorder };
  for (let column = 0; column < 9; column += 1) {
    set(
      ws,
      XLSX.utils.encode_cell({ r: totalRow, c: column }),
      column === 0 ? 'TỔNG CHÊNH LỆCH' : '',
      totalLabel,
    );
  }
  merge(ws, `A${totalRow + 1}:I${totalRow + 1}`);
  set(ws, `J${totalRow + 1}`, totalDifference, {
    ...money,
    font: { name: 'Times New Roman', sz: 11, bold: true },
    border: totalBorder,
  });
  set(ws, `K${totalRow + 1}`, '', totalLabel);
  ws['!ref'] = `A1:K${totalRow + 1}`;
  return ws;
}

/** Một workbook duy nhất phục vụ cả tải Excel và in PDF. */
function employeeReportWorkbook(data, input, selected, extras, type) {
  const workbook = XLSX.utils.book_new();
  // Chỉ còn bảng kê theo khoảng ngày; báo cáo năm đã được bỏ.
  if (type === 'daily') {
    if (!selected.length) throw badRequest('Không có nhân viên đang hoạt động để xuất báo cáo.');
    validateExtraCostAssignments(extras, selected, input.employeeId);
    if (input.employeeId) {
      XLSX.utils.book_append_sheet(
        workbook,
        dailySheet(data, input, selected[0], extras),
        'Bảng kê cước',
      );
    } else {
      XLSX.utils.book_append_sheet(
        workbook,
        dailySummarySheet(data, input, selected, extras),
        'Tổng hợp',
      );
      const usedNames = new Set(workbook.SheetNames);
      for (const employee of selected) {
        XLSX.utils.book_append_sheet(
          workbook,
          dailySheet(
            data,
            input,
            employee,
            extras.filter((item) => item.employeeId === employee.id),
          ),
          uniqueSheetName(employee.full_name, usedNames),
        );
      }
    }
  } else throw badRequest('Loại báo cáo không hợp lệ.');
  return workbook;
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
    const company =
      c.db.prepare('SELECT company_name, company_address FROM app_settings WHERE id = 1').get() ||
      {};
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();
    for (const [employeeName, items] of groups) {
      XLSX.utils.book_append_sheet(
        workbook,
        fuelHistorySheet(items, input, employeeName, company),
        uniqueSheetName(employeeName, usedNames),
      );
    }
    const contentBase64 = portraitWorkbookBase64(workbook);
    writeAudit(c.db, c.user, 'report.fuel_history.export', 'report', null, {
      ...input,
      rows: report.items.length,
      sheetCount: workbook.SheetNames.length,
    });
    const employeeName = input.employeeId
      ? c.db.prepare('SELECT full_name FROM employees WHERE id = ?').get(input.employeeId)
          ?.full_name || 'Chưa gán nhân viên'
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
    const canReportAll = canSeeEveryone(c.user);
    const ownEmployeeId = canReportAll ? null : reportInputForUser(c.db, c.user, {}).employeeId;
    return { ...reportCatalog(c.db, ownEmployeeId), canReportAll };
  });
  router.get('/api/reports/carrier-variance', async (c) => {
    c.requirePage(CARRIER_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xem báo cáo tổng hợp.');
    const input = filters(c.query, true);
    // Phân trang để bảng không phải hiển thị hàng nghìn dòng một lúc; số liệu
    // tổng hợp vẫn tính trên toàn bộ kết quả. Xuất Excel vẫn đủ mọi dòng.
    const summary = carrierVarianceSummary(c.db, input);
    const pageSize = Math.min(
      Math.max(Number(c.query.pageSize) || CARRIER_VARIANCE_PAGE_SIZE, 1),
      500,
    );
    const pageCount = Math.max(1, Math.ceil(summary.entries / pageSize));
    const page = Math.min(Math.max(Number(c.query.page) || 1, 1), pageCount);
    const items = carrierVariance(c.db, input, { limit: pageSize, offset: (page - 1) * pageSize });
    const employees = c.db
      .prepare(
        'SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE',
      )
      .all();
    return {
      employees: employees.map((item) => ({ id: item.id, fullName: item.full_name })),
      items,
      summary,
      page,
      pageCount,
      pageSize,
    };
  });
  router.get('/api/reports/carrier-variance/export', async (c) => {
    c.requirePage(CARRIER_PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Bạn không có quyền xuất báo cáo.');
    const input = filters(c.query, true);
    const items = carrierVariance(c.db, input);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, carrierVarianceSheet(items, input), 'Chênh lệch cước');
    const contentBase64 = XLSX.write(workbook, {
      type: 'base64',
      bookType: 'xlsx',
      compression: true,
    });
    writeAudit(c.db, c.user, 'report.carrier_variance.export', 'report', null, {
      ...input,
      rows: items.length,
    });
    return {
      fileName: input.all
        ? 'Báo cáo chênh lệch cước nhà xe.xlsx'
        : `Báo cáo chênh lệch cước nhà xe từ ngày ${formatFileDate(input.from)} đến ${formatFileDate(input.to)}.xlsx`,
      contentBase64,
    };
  });
  router.get('/api/reports/export', async (c) => {
    c.requirePage(EMPLOYEE_PAGE);
    const input = reportInputForUser(c.db, c.user, filters(c.query));
    const type = String(c.query.type ?? 'daily');
    const extras = type === 'daily' ? extraCosts(c.query) : [];
    const data = reportData(c.db, input);
    const selected = input.employeeId
      ? data.employees.filter((item) => item.id === input.employeeId)
      : data.employees;
    const workbook = employeeReportWorkbook(data, input, selected, extras, type);
    const contentBase64 = landscapeWorkbookBase64(workbook);
    const suffix = input.employeeId
      ? `Bảng kê ${selected[0].full_name} từ ${formatFileDate(input.from)} đến ${formatFileDate(input.to)}`
      : `Bảng kê tất cả nhân viên từ ${formatFileDate(input.from)} đến ${formatFileDate(input.to)}`;
    writeAudit(c.db, c.user, 'report.export', 'report', null, {
      type,
      ...input,
      extraCosts: extras,
      sheetCount: workbook.SheetNames.length,
    });
    return { fileName: `${suffix}.xlsx`, contentBase64 };
  });
  router.get('/api/reports/print', async (c) => {
    c.requirePage(EMPLOYEE_PAGE);
    const input = reportInputForUser(c.db, c.user, filters(c.query));
    const type = String(c.query.type ?? 'daily');
    const extras = type === 'daily' ? extraCosts(c.query) : [];
    const data = reportData(c.db, input);
    const selected = input.employeeId
      ? data.employees.filter((item) => item.id === input.employeeId)
      : data.employees;
    const workbook = employeeReportWorkbook(data, input, selected, extras, type);
    const sheets = workbook.SheetNames.map((name) =>
      worksheetForPrint(workbook.Sheets[name], name),
    );
    writeAudit(c.db, c.user, 'report.print', 'report', null, {
      type,
      ...input,
      extraCosts: extras,
      sheetCount: sheets.length,
    });
    return { type, sheets };
  });
}

module.exports = {
  register,
  _test: { deliveryRows, dailyDetailRows, uniqueSheetName, validateExtraCostAssignments },
};
