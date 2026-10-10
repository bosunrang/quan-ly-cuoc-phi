'use strict';

const { misaDedupeKey, normalizeSearchText, transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const { IMPORT_MAX_BODY_BYTES, badRequest, isIsoDate } = require('../http.cjs');

const PAGE = 'misa';
const MAX_ROWS = 25_000;
const SQLITE_PARAMETER_CHUNK = 900;
// Cache theo từng CSDL để nhiều ứng dụng chạy trong cùng tiến trình vẫn không
// dùng nhầm tổng quan của nhau.
const defaultOverviewByDatabase = new WeakMap();

function invalidateDefaultOverview(db) {
  defaultOverviewByDatabase.delete(db);
}

function text(value, field, max) {
  const result = String(value ?? '').trim();
  if (result.length > max) {
    throw badRequest(`${field} không được dài quá ${max} ký tự.`);
  }
  return result;
}

function readRows(value) {
  if (!Array.isArray(value)) throw badRequest('Dữ liệu xem trước không hợp lệ.');
  if (value.length > MAX_ROWS) {
    throw badRequest(`Mỗi lần chỉ nhập tối đa ${MAX_ROWS} dòng.`);
  }
  return value;
}

function normalizeRow(row) {
  const documentDate = text(row?.documentDate, 'Ngày chứng từ', 10);
  const documentCode = text(row?.documentCode, 'Số chứng từ', 100);
  const customerCode = text(row?.customerCode, 'Mã khách hàng', 100);
  const customerName = text(row?.customerName, 'Tên khách hàng', 300);
  const address = text(row?.address, 'Địa chỉ', 600);
  const productCode = text(row?.productCode, 'Mã hàng', 100);
  const productName = text(row?.productName, 'Tên mặt hàng', 500);
  const provinceCity = text(row?.provinceCity, 'Tỉnh/Thành phố', 150);
  const sourceKey = text(row?.sourceKey, 'Khóa nguồn', 500);
  const rawQuantity = row?.quantitySold;
  const quantitySold =
    rawQuantity === null || rawQuantity === undefined || rawQuantity === ''
      ? Number.NaN
      : Number(rawQuantity);
  let reason = '';
  if (!isIsoDate(documentDate)) reason = 'Ngày chứng từ không hợp lệ';
  else if (!customerName) reason = 'Thiếu tên khách hàng';
  else if (!productName) reason = 'Thiếu tên mặt hàng';
  else if (!Number.isFinite(quantitySold)) reason = 'Số lượng bán không hợp lệ';
  else if (!sourceKey) reason = 'Không tạo được khóa nhận diện dòng';

  return {
    rowNumber: Number(row?.rowNumber) || 0,
    documentDate,
    documentCode,
    customerCode,
    customerName,
    customerKey: normalizeSearchText(customerName),
    address,
    productCode,
    productName,
    quantitySold: Number.isFinite(quantitySold) ? quantitySold : null,
    provinceCity,
    sourceKey,
    dedupeKey: misaDedupeKey({
      documentCode,
      customerCode,
      productCode,
      productName,
      quantitySold,
    }),
    status: reason ? 'skipped' : 'ready',
    reason,
  };
}

function existingRows(db, rows) {
  const sourceKeys = [
    ...new Set(rows.filter((row) => row.status === 'ready').map((row) => row.sourceKey)),
  ];
  const dedupeKeys = [
    ...new Set(
      rows.filter((row) => row.status === 'ready' && row.dedupeKey).map((row) => row.dedupeKey),
    ),
  ];
  const bySourceKey = new Map();
  // Số dòng đã lưu theo từng khóa nghiệp vụ. Một hóa đơn có thể có nhiều dòng
  // cùng mã hàng và số lượng nhưng khác số lô, nên phải đếm chứ không gộp.
  const dedupeCounts = new Map();
  const chunks = (keys, read) => {
    for (let offset = 0; offset < keys.length; offset += SQLITE_PARAMETER_CHUNK) {
      const batch = keys.slice(offset, offset + SQLITE_PARAMETER_CHUNK);
      read(batch, batch.map(() => '?').join(', '));
    }
  };
  chunks(sourceKeys, (batch, placeholders) => {
    for (const row of db
      .prepare(
        `SELECT source_key, dedupe_key, product_name, customer_code, product_code
           FROM misa_rows WHERE source_key IN (${placeholders})`,
      )
      .all(...batch)) {
      bySourceKey.set(row.source_key, row);
    }
  });
  chunks(dedupeKeys, (batch, placeholders) => {
    for (const row of db
      .prepare(
        `SELECT dedupe_key, COUNT(*) AS count
           FROM misa_rows WHERE dedupe_key IN (${placeholders})
          GROUP BY dedupe_key`,
      )
      .all(...batch)) {
      dedupeCounts.set(row.dedupe_key, Number(row.count));
    }
  });
  return { bySourceKey, dedupeCounts };
}

/**
 * Phân loại từng dòng của file: mới, bổ sung thông tin cho dòng cũ, hoặc trùng.
 *
 * Dòng khớp nguyên khóa nguồn là chính dòng đã lưu. Các dòng còn lại so theo
 * khóa nghiệp vụ (không gồm số lô, tên khách, địa chỉ vì có thể đổi giữa hai
 * lần xuất): file có N dòng cùng khóa, CSDL đã có M dòng thì chỉ N − M dòng là
 * mới. Nhờ vậy hai dòng khác lô của cùng hóa đơn được lưu đủ, còn nhập chồng
 * khoảng ngày (kể cả khi lô/tên khách đã đổi) không nhân đôi dữ liệu.
 */
function classifyRows(db, rows) {
  const existing = existingRows(db, rows);
  const seenSourceKeys = new Set();
  const unique = rows.map((row) => {
    if (row.status === 'skipped') return { row, kind: 'skipped' };
    if (seenSourceKeys.has(row.sourceKey)) return { row, kind: 'duplicateInFile' };
    seenSourceKeys.add(row.sourceKey);
    const previous = existing.bySourceKey.get(row.sourceKey);
    return previous ? { row, kind: 'existing', previous } : { row, kind: 'candidate' };
  });

  // Dòng CSDL cùng khóa chưa được dòng nào trong file khớp theo khóa nguồn.
  const unmatched = new Map(existing.dedupeCounts);
  for (const item of unique) {
    const key = item.kind === 'existing' ? item.previous.dedupe_key : '';
    if (key && unmatched.has(key)) unmatched.set(key, Math.max(0, unmatched.get(key) - 1));
  }

  return unique.map((item) => {
    if (item.kind === 'existing') {
      return { ...item, kind: canEnrich(item.previous, item.row) ? 'enrich' : 'duplicate' };
    }
    if (item.kind !== 'candidate' || !item.row.dedupeKey) return item;
    const remaining = unmatched.get(item.row.dedupeKey) ?? 0;
    if (remaining > 0) {
      unmatched.set(item.row.dedupeKey, remaining - 1);
      return { ...item, kind: 'duplicateByBusinessKey' };
    }
    return item;
  });
}

function canEnrich(previous, row) {
  return (
    (!previous.product_name && row.productName) ||
    (!previous.customer_code && row.customerCode) ||
    (!previous.product_code && row.productCode)
  );
}

function previewRows(db, sourceRows) {
  return classifyRows(db, sourceRows.map(normalizeRow)).map(({ row, kind, previous }) => {
    if (kind === 'duplicateInFile') {
      return { ...row, status: 'duplicate', reason: 'Dòng trùng trong file' };
    }
    if (kind === 'duplicate') {
      return { ...row, status: 'duplicate', reason: 'Dòng đã tồn tại' };
    }
    if (kind === 'duplicateByBusinessKey') {
      return {
        ...row,
        status: 'duplicate',
        reason: 'Trùng mã khách hàng, đơn hàng, mã hàng, sản phẩm và số lượng',
      };
    }
    if (kind === 'enrich') {
      return {
        ...row,
        reason:
          !previous.customer_code && row.customerCode
            ? 'Bổ sung mã khách hàng'
            : !previous.product_code && row.productCode
              ? 'Bổ sung mã hàng'
              : 'Bổ sung tên mặt hàng',
      };
    }
    return row;
  });
}

function counts(fileName, rows) {
  return {
    fileName,
    rows,
    totalRows: rows.length,
    readyCount: rows.filter((row) => row.status === 'ready').length,
    duplicateCount: rows.filter((row) => row.status === 'duplicate').length,
    skippedCount: rows.filter((row) => row.status === 'skipped').length,
  };
}

function searchExpression(value) {
  return normalizeSearchText(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(' ');
}

function readOverview(db, clause = '1 = 1', params = []) {
  const summary = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(quantity_sold), 0) AS total_quantity,
              COUNT(DISTINCT customer_name) AS customer_count,
              COUNT(DISTINCT CASE WHEN province_city <> '' THEN province_city END) AS province_count
         FROM misa_rows WHERE ${clause}`,
    )
    .get(...params);
  return {
    count: Number(summary.count),
    totalQuantity: Number(summary.total_quantity),
    customerCount: Number(summary.customer_count),
    provinceCount: Number(summary.province_count),
  };
}

function readDefaultOverview(db) {
  const overview = readOverview(db);
  const provinces = db
    .prepare(
      `SELECT DISTINCT province_city FROM misa_rows
        WHERE province_city <> '' ORDER BY province_city`,
    )
    .all()
    .map((row) => row.province_city);
  const lastImport = db
    .prepare(
      `SELECT source_file, imported_at FROM misa_rows
        ORDER BY imported_at DESC, id DESC LIMIT 1`,
    )
    .get();
  return {
    ...overview,
    provinces,
    lastImport: lastImport
      ? { fileName: lastImport.source_file, importedAt: lastImport.imported_at }
      : null,
  };
}

function register(router) {
  router.get('/api/misa', async (c) => {
    c.requirePage(PAGE);
    const where = ['1 = 1'];
    const params = [];
    const search = String(c.query.search ?? '')
      .trim()
      .slice(0, 100);
    const province = String(c.query.province ?? '')
      .trim()
      .slice(0, 150);
    if (search) {
      const expression = searchExpression(search);
      if (expression) {
        where.push('misa_rows.id IN (SELECT rowid FROM misa_search WHERE misa_search MATCH ?)');
        params.push(expression);
      }
    }
    if (province) {
      where.push('province_city = ?');
      params.push(province);
    }
    const clause = where.join(' AND ');
    const pageSize = 50;
    const requestedPage = Math.max(Number(c.query.page) || 1, 1);
    const isDefaultQuery = !search && !province;
    // Tổng quan không lọc chỉ đổi khi nhập, xóa hoặc khôi phục dữ liệu. Giữ
    // theo từng CSDL để chuyển trang không phải quét lại toàn bộ dữ liệu.
    let defaultOverview = defaultOverviewByDatabase.get(c.db);
    if (!defaultOverview) {
      defaultOverview = readDefaultOverview(c.db);
      defaultOverviewByDatabase.set(c.db, defaultOverview);
    }
    const overview = isDefaultQuery ? defaultOverview : readOverview(c.db, clause, params);
    const count = overview.count;
    const pageCount = Math.max(1, Math.ceil(count / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const rows = c.db
      .prepare(
        `SELECT id, document_date, document_code, customer_code, customer_name, address, product_code, product_name, quantity_sold,
                province_city, source_file, imported_at
           FROM misa_rows WHERE ${clause}
          ORDER BY document_date DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize);
    const defaultMeta = defaultOverview;

    return {
      items: rows.map((row) => ({
        id: row.id,
        documentDate: row.document_date,
        documentCode: row.document_code,
        customerCode: row.customer_code,
        customerName: row.customer_name,
        address: row.address,
        productCode: row.product_code,
        productName: row.product_name,
        quantitySold: Number(row.quantity_sold),
        provinceCity: row.province_city,
        sourceFile: row.source_file,
        importedAt: row.imported_at,
      })),
      count,
      totalQuantity: overview.totalQuantity,
      customerCount: overview.customerCount,
      provinceCount: overview.provinceCount,
      provinces: defaultMeta.provinces,
      page,
      pageCount,
      pageSize,
      lastImport: defaultMeta.lastImport,
    };
  });

  router.post(
    '/api/misa/preview',
    async (c) => {
      c.requirePage(PAGE);
      const fileName = text(c.body.fileName, 'Tên file', 260);
      if (!fileName) throw badRequest('Vui lòng chọn file MISA.');
      return counts(fileName, previewRows(c.db, readRows(c.body.rows)));
    },
    { page: PAGE, maxBodyBytes: IMPORT_MAX_BODY_BYTES },
  );

  router.post(
    '/api/misa/import',
    async (c) => {
      c.requirePage(PAGE);
      const fileName = text(c.body.fileName, 'Tên file', 260);
      const rows = readRows(c.body.rows).map(normalizeRow);
      if (!fileName) throw badRequest('Vui lòng chọn file MISA.');
      if (rows.some((row) => row.status === 'skipped')) {
        throw badRequest('Dữ liệu nhập còn dòng không hợp lệ.');
      }
      const importedAt = new Date().toISOString();

      const result = transaction(c.db, () => {
        const insert = c.db.prepare(
          `INSERT INTO misa_rows
          (document_date, document_code, customer_code, customer_name, customer_key, address, product_code, product_name, quantity_sold, province_city,
            source_key, dedupe_key, source_file, imported_by, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_key) DO UPDATE SET
           product_name = CASE WHEN misa_rows.product_name = '' THEN excluded.product_name ELSE misa_rows.product_name END,
           customer_code = CASE WHEN misa_rows.customer_code = '' THEN excluded.customer_code ELSE misa_rows.customer_code END,
           product_code = CASE WHEN misa_rows.product_code = '' THEN excluded.product_code ELSE misa_rows.product_code END,
           dedupe_key = CASE WHEN misa_rows.dedupe_key = '' THEN excluded.dedupe_key ELSE misa_rows.dedupe_key END,
           source_file = excluded.source_file,
           imported_by = excluded.imported_by,
           imported_at = excluded.imported_at
         WHERE (misa_rows.product_name = '' AND excluded.product_name <> '')
            OR (misa_rows.customer_code = '' AND excluded.customer_code <> '')
            OR (misa_rows.product_code = '' AND excluded.product_code <> '')
            OR (misa_rows.dedupe_key = '' AND excluded.dedupe_key <> '')`,
        );
        let inserted = 0;
        let duplicates = 0;
        for (const { row, kind } of classifyRows(c.db, rows)) {
          if (kind !== 'candidate' && kind !== 'enrich') {
            duplicates += 1;
            continue;
          }
          const result = insert.run(
            row.documentDate,
            row.documentCode,
            row.customerCode,
            row.customerName,
            row.customerKey,
            row.address,
            row.productCode,
            row.productName,
            row.quantitySold,
            row.provinceCity,
            row.sourceKey,
            row.dedupeKey,
            fileName,
            c.user.id,
            importedAt,
          );
          if (result.changes) inserted += Number(result.changes);
          else duplicates += 1;
        }
        writeAudit(c.db, c.user, 'misa.import', 'misa', fileName, {
          requested: rows.length,
          inserted,
          duplicates,
        });
        return { inserted, duplicates };
      });
      // Nhập thành công thì lần xem tiếp theo phải lấy số tổng quan mới.
      invalidateDefaultOverview(c.db);
      return result;
    },
    { page: PAGE, maxBodyBytes: IMPORT_MAX_BODY_BYTES },
  );
}

module.exports = { register, invalidateDefaultOverview };
