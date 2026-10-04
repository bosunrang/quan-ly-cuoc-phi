'use strict';

const { transaction, normalizeSearchText } = require('../db.cjs');
const { replaceCustomerCarriers, refreshCustomerCarrier } = require('../carrier-links.cjs');
const { writeAudit } = require('../audit.cjs');
const { IMPORT_MAX_BODY_BYTES, badRequest, notFound } = require('../http.cjs');

const PAGE = 'customers';
const PAGE_SIZE = 50;
// Cùng mức với luồng MISA: đủ cho các file danh mục lớn nhưng vẫn chặn yêu
// cầu bất thường làm đầy bộ nhớ máy chủ.
const MAX_IMPORT_ROWS = 25_000;
const linkedCarrierNamesSql = `(
  SELECT GROUP_CONCAT(name, ', ')
  FROM (
    SELECT carriers.name AS name
    FROM carrier_customers
    INNER JOIN carriers ON carriers.id = carrier_customers.carrier_id
    WHERE carrier_customers.customer_id = customers.id
    ORDER BY carriers.name COLLATE NOCASE
  )
)`;
const linkedCarrierSearchSql = `EXISTS (
  SELECT 1
  FROM carrier_customers
  INNER JOIN carriers ON carriers.id = carrier_customers.carrier_id
  WHERE carrier_customers.customer_id = customers.id
    AND carriers.carrier_key LIKE ?
)`;

function text(value, field, { max = 300, required = false } = {}) {
  const result = String(value ?? '').trim();
  if (required && !result) throw badRequest(`Vui lòng nhập ${field}.`);
  if (result.length > max) {
    throw badRequest(`${field} không được dài quá ${max} ký tự.`);
  }
  return result;
}

function readCustomerInput(body) {
  const customerName = text(body.customerName, 'tên khách hàng', { required: true });
  const customerCode = text(body.customerCode, 'mã khách hàng', { max: 100 });
  const carrier = text(body.carrier, 'nhà xe');
  const address = text(body.address, 'địa chỉ giao hàng', { max: 500 });
  return {
    customerName,
    customerCode,
    carrier,
    address,
    customerKey: normalizeSearchText(customerName),
    customerCodeKey: customerCode.toLocaleUpperCase('vi-VN'),
    searchText: normalizeSearchText(`${customerName} ${customerCode} ${carrier} ${address}`),
  };
}

function readImportRows(value) {
  if (!Array.isArray(value)) throw badRequest('Dữ liệu nhập khách hàng không hợp lệ.');
  if (!value.length) throw badRequest('File không có dòng khách hàng hợp lệ.');
  if (value.length > MAX_IMPORT_ROWS) {
    throw badRequest(
      `Mỗi lần chỉ nhập tối đa ${MAX_IMPORT_ROWS.toLocaleString('vi-VN')} khách hàng.`,
    );
  }
  return value;
}

function toApi(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerCode: row.customer_code,
    carrier: row.linked_carrier_names || row.carrier,
    address: row.address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadCustomer(db, id) {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!row) throw notFound('Không tìm thấy khách hàng.');
  return row;
}

function ensureNameAvailable(db, customerKey, ignoreId = null) {
  const row = ignoreId
    ? db
        .prepare('SELECT id FROM customers WHERE customer_key = ? AND id <> ?')
        .get(customerKey, ignoreId)
    : db.prepare('SELECT id FROM customers WHERE customer_key = ?').get(customerKey);
  if (row) throw badRequest('Tên khách hàng này đã có trong danh sách.');
}

function ensureCodeAvailable(db, customerCode, ignoreId = null) {
  if (!customerCode) return;
  const row = ignoreId
    ? db
        .prepare('SELECT id FROM customers WHERE customer_code = ? COLLATE NOCASE AND id <> ?')
        .get(customerCode, ignoreId)
    : db
        .prepare('SELECT id FROM customers WHERE customer_code = ? COLLATE NOCASE')
        .get(customerCode);
  if (row) throw badRequest('Mã khách hàng này đã được sử dụng.');
}

function register(router) {
  // Dùng riêng cho phần xem trước Excel. Không dùng phân trang vì nếu chỉ lấy
  // trang đầu, các khách hàng ở sau sẽ bị báo nhầm là sẵn sàng nhập.
  router.get('/api/customers/import-keys', async (c) => {
    c.requirePage(PAGE);
    const rows = c.db
      .prepare('SELECT customer_key, customer_code FROM customers ORDER BY id')
      .all();
    return {
      items: rows.map((row) => ({
        nameKey: row.customer_key,
        codeKey: String(row.customer_code || '').toLocaleUpperCase('vi-VN'),
      })),
    };
  });

  router.get('/api/customers', async (c) => {
    c.requirePage(PAGE);
    const search = normalizeSearchText(String(c.query.search ?? '').slice(0, 150));
    const page = Math.max(1, Number(c.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(c.query.limit) || PAGE_SIZE));
    const summary = c.db
      .prepare(
        `WITH linked_customers AS (
           SELECT id AS customer_id FROM customers WHERE carrier <> ''
           UNION
           SELECT customer_id FROM carrier_customers
         )
		 SELECT COUNT(*) AS count,
		        (SELECT COUNT(*) FROM linked_customers) AS carrier_count,
		        COUNT(NULLIF(address, '')) AS address_count
           FROM customers`,
      )
      .get();
    const resultCount = search
      ? Number(
          c.db
            .prepare(
              `SELECT COUNT(*) AS count
                 FROM customers
                WHERE search_text LIKE ? OR ${linkedCarrierSearchSql}`,
            )
            .get(`%${search}%`, `%${search}%`).count,
        )
      : Number(summary.count);
    const pageCount = Math.max(1, Math.ceil(resultCount / pageSize));
    const currentPage = Math.min(page, pageCount);
    const offset = (currentPage - 1) * pageSize;
    const rows = search
      ? c.db
          .prepare(
            `SELECT customers.*, ${linkedCarrierNamesSql} AS linked_carrier_names
             FROM customers
             WHERE search_text LIKE ? OR ${linkedCarrierSearchSql}
             ORDER BY customer_name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
          )
          .all(`%${search}%`, `%${search}%`, pageSize, offset)
      : c.db
          .prepare(
            `SELECT customers.*, ${linkedCarrierNamesSql} AS linked_carrier_names
             FROM customers
             ORDER BY customer_name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
          )
          .all(pageSize, offset);
    return {
      items: rows.map(toApi),
      count: Number(summary.count),
      resultCount,
      carrierCount: Number(summary.carrier_count),
      addressCount: Number(summary.address_count),
      page: currentPage,
      pageSize,
      pageCount,
    };
  });

  router.post('/api/customers', async (c) => {
    c.requirePage(PAGE);
    const input = readCustomerInput(c.body);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      ensureNameAvailable(c.db, input.customerKey);
      ensureCodeAvailable(c.db, input.customerCode);
      const result = c.db
        .prepare(
          `INSERT INTO customers
			  (customer_name, customer_code, carrier, address, customer_key, search_text, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.customerName,
          input.customerCode,
          input.carrier,
          input.address,
          input.customerKey,
          input.searchText,
          at,
          at,
        );
      const row = loadCustomer(c.db, Number(result.lastInsertRowid));
      replaceCustomerCarriers(c.db, row.id, input.carrier, at);
      refreshCustomerCarrier(c.db, row.id, at);
      const after = loadCustomer(c.db, row.id);
      writeAudit(c.db, c.user, 'customer.create', 'customer', after.id, toApi(after));
      return toApi(after);
    });
  });

  router.post(
    '/api/customers/import',
    async (c) => {
      c.requirePage(PAGE);
      const rows = readImportRows(c.body.rows).map(readCustomerInput);
      const at = new Date().toISOString();
      return transaction(c.db, () => {
        const existingRows = c.db.prepare('SELECT * FROM customers ORDER BY id').all();
        const existingByName = new Map(existingRows.map((row) => [row.customer_key, row]));
        const existingByCode = new Map(
          existingRows
            .filter((row) => row.customer_code)
            .map((row) => [String(row.customer_code).toLocaleUpperCase('vi-VN'), row]),
        );
        const insert = c.db.prepare(
          'INSERT INTO customers (customer_name, customer_code, carrier, address, customer_key, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        );
        const update = c.db.prepare(
          `UPDATE customers SET
			customer_name = ?, customer_code = ?, address = ?,
            customer_key = ?, updated_at = ?
          WHERE id = ?`,
        );
        const handledCodes = new Set();
        const handledNames = new Set();
        let inserted = 0;
        let updated = 0;
        let duplicates = 0;
        for (const input of rows) {
          if (
            handledNames.has(input.customerKey) ||
            (input.customerCodeKey && handledCodes.has(input.customerCodeKey))
          ) {
            duplicates += 1;
            continue;
          }
          handledNames.add(input.customerKey);
          if (input.customerCodeKey) handledCodes.add(input.customerCodeKey);

          const sameCode = input.customerCodeKey ? existingByCode.get(input.customerCodeKey) : null;
          const sameName = existingByName.get(input.customerKey);
          if (sameCode) {
            if (sameName && sameName.id !== sameCode.id) {
              duplicates += 1;
              continue;
            }
            const previousKey = sameCode.customer_key;
            const customerCode = sameCode.customer_code || input.customerCode;
            const address = input.address || sameCode.address;
            update.run(
              input.customerName,
              customerCode,
              address,
              input.customerKey,
              at,
              sameCode.id,
            );
            // Import chỉ bổ sung nhà xe mới; không gỡ các liên kết/bảng cước cũ.
            replaceCustomerCarriers(
              c.db,
              sameCode.id,
              [sameCode.carrier, input.carrier].filter(Boolean).join(', '),
              at,
            );
            refreshCustomerCarrier(c.db, sameCode.id, at);
            const after = loadCustomer(c.db, sameCode.id);
            existingByName.delete(previousKey);
            existingByName.set(after.customer_key, after);
            existingByCode.set(input.customerCodeKey, after);
            updated += 1;
            continue;
          }

          if (sameName) {
            // Cùng tên và bản ghi cũ chưa có mã: bổ sung mã mới mà
            // không tạo thêm khách hàng, nhờ đó giữ nguyên liên kết nhà xe.
            if (input.customerCode && !sameName.customer_code) {
              update.run(
                input.customerName,
                input.customerCode,
                input.address || sameName.address,
                input.customerKey,
                at,
                sameName.id,
              );
              replaceCustomerCarriers(
                c.db,
                sameName.id,
                [sameName.carrier, input.carrier].filter(Boolean).join(', '),
                at,
              );
              refreshCustomerCarrier(c.db, sameName.id, at);
              const after = loadCustomer(c.db, sameName.id);
              existingByName.set(after.customer_key, after);
              existingByCode.set(input.customerCodeKey, after);
              updated += 1;
              continue;
            }
            duplicates += 1;
            continue;
          }

          const result = insert.run(
            input.customerName,
            input.customerCode,
            input.carrier,
            input.address,
            input.customerKey,
            input.searchText,
            at,
            at,
          );
          const customerId = Number(result.lastInsertRowid);
          replaceCustomerCarriers(c.db, customerId, input.carrier, at);
          refreshCustomerCarrier(c.db, customerId, at);
          const after = loadCustomer(c.db, customerId);
          existingByName.set(after.customer_key, after);
          if (input.customerCodeKey) existingByCode.set(input.customerCodeKey, after);
          inserted += 1;
        }
        writeAudit(c.db, c.user, 'customer.import', 'customer', null, {
          inserted,
          updated,
          duplicates,
        });
        return { inserted, updated, duplicates };
      });
    },
    { page: PAGE, maxBodyBytes: IMPORT_MAX_BODY_BYTES },
  );

  router.patch('/api/customers/:id', async (c) => {
    c.requirePage(PAGE);
    const before = loadCustomer(c.db, Number(c.params.id));
    const input = readCustomerInput(c.body);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      ensureNameAvailable(c.db, input.customerKey, before.id);
      ensureCodeAvailable(c.db, input.customerCode, before.id);
      c.db
        .prepare(
          `UPDATE customers SET
			  customer_name = ?, customer_code = ?, carrier = ?, address = ?,
             customer_key = ?, search_text = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.customerName,
          input.customerCode,
          input.carrier,
          input.address,
          input.customerKey,
          input.searchText,
          at,
          before.id,
        );
      replaceCustomerCarriers(c.db, before.id, input.carrier, at);
      refreshCustomerCarrier(c.db, before.id, at);
      const after = loadCustomer(c.db, before.id);
      writeAudit(c.db, c.user, 'customer.update', 'customer', before.id, {
        before: toApi(before),
        after: toApi(after),
      });
      return toApi(after);
    });
  });

  router.delete('/api/customers/:id', async (c) => {
    c.requirePage(PAGE);
    const row = loadCustomer(c.db, Number(c.params.id));
    return transaction(c.db, () => {
      c.db.prepare('DELETE FROM customers WHERE id = ?').run(row.id);
      writeAudit(c.db, c.user, 'customer.delete', 'customer', row.id, toApi(row));
      return { ok: true };
    });
  });
}

module.exports = { register };
