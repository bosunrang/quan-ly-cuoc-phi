'use strict';

const { transaction, normalizeSearchText } = require('../db.cjs');
const { replaceCustomerCarriers, refreshCustomerCarrier } = require('../carrier-links.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest, notFound } = require('../http.cjs');

const PAGE = 'customers';
const PAGE_SIZE = 50;
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
  const carrier = text(body.carrier, 'nhà xe');
  const recipient = text(body.recipient, 'người nhận');
  const address = text(body.address, 'địa chỉ giao hàng', { max: 500 });
  return {
    customerName,
    carrier,
    recipient,
    address,
    customerKey: normalizeSearchText(customerName),
    searchText: normalizeSearchText(
      `${customerName} ${carrier} ${recipient} ${address}`,
    ),
  };
}

function toApi(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    carrier: row.linked_carrier_names || row.carrier,
    recipient: row.recipient,
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

function register(router) {
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
                COUNT(DISTINCT NULLIF(recipient, '')) AS recipient_count,
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
      recipientCount: Number(summary.recipient_count),
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
      const result = c.db
        .prepare(
          `INSERT INTO customers
             (customer_name, carrier, recipient, address, customer_key, search_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.customerName,
          input.carrier,
          input.recipient,
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

  router.post('/api/customers/import', async (c) => {
    c.requirePage(PAGE);
    const sourceRows = Array.isArray(c.body.rows) ? c.body.rows.slice(0, 1000) : [];
    if (!sourceRows.length) throw badRequest('File không có dòng khách hàng hợp lệ.');
    const rows = sourceRows.map(readCustomerInput);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      const existing = new Set(
        c.db.prepare('SELECT customer_key FROM customers').all().map((row) => row.customer_key),
      );
      const insert = c.db.prepare(
        'INSERT INTO customers (customer_name, carrier, recipient, address, customer_key, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      let inserted = 0;
      let duplicates = 0;
      for (const input of rows) {
        if (existing.has(input.customerKey)) {
          duplicates += 1;
          continue;
        }
        const result = insert.run(
          input.customerName,
          input.carrier,
          input.recipient,
          input.address,
          input.customerKey,
          input.searchText,
          at,
          at,
        );
        const customerId = Number(result.lastInsertRowid);
        replaceCustomerCarriers(c.db, customerId, input.carrier, at);
        refreshCustomerCarrier(c.db, customerId, at);
        existing.add(input.customerKey);
        inserted += 1;
      }
      writeAudit(c.db, c.user, 'customer.import', 'customer', null, { inserted, duplicates });
      return { inserted, duplicates };
    });
  });

  router.patch('/api/customers/:id', async (c) => {
    c.requirePage(PAGE);
    const before = loadCustomer(c.db, Number(c.params.id));
    const input = readCustomerInput(c.body);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      ensureNameAvailable(c.db, input.customerKey, before.id);
      c.db
        .prepare(
          `UPDATE customers SET
             customer_name = ?, carrier = ?, recipient = ?, address = ?,
             customer_key = ?, search_text = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.customerName,
          input.carrier,
          input.recipient,
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
