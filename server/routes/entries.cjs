'use strict';

const { normalizeSearchText, transaction } = require('../db.cjs');
const { ensureCustomerCarrier, refreshCustomerCarrier } = require('../carrier-links.cjs');
const { writeAudit } = require('../audit.cjs');
const { canSeeEveryone } = require('../permissions.cjs');
const { badRequest, notFound } = require('../http.cjs');

const PAGE = 'entries';
const MAX_LIMIT = 500;

// ---------------------------------------------------------------- kiểm tra

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value, field, { max = 200, required = false } = {}) {
  const result = String(value ?? '').trim();
  if (required && !result) throw badRequest(`Vui lòng nhập ${field}.`);
  if (result.length > max) {
    throw badRequest(`${field} không được dài quá ${max} ký tự.`);
  }
  return result;
}

function money(value, field) {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result) || !Number.isInteger(result)) {
    throw badRequest(`${field} phải là số nguyên (đơn vị đồng).`);
  }
  if (result < 0) throw badRequest(`${field} không được âm.`);
  if (result > 1_000_000_000_000) throw badRequest(`${field} vượt quá giới hạn.`);
  return result;
}

function readEntryInput(body) {
  const entryDate = String(body.entryDate ?? '').trim();
  if (!DATE_PATTERN.test(entryDate)) {
    throw badRequest('Ngày không hợp lệ (cần dạng YYYY-MM-DD).');
  }
  const misaDocumentDate = text(body.misaDocumentDate, 'Ngày chứng từ MISA', { max: 10 });
  if (misaDocumentDate && !DATE_PATTERN.test(misaDocumentDate)) {
    throw badRequest('Ngày chứng từ MISA không hợp lệ.');
  }
  return {
    entryDate,
    customer: text(body.customer, 'tên khách hàng', { required: true }),
    carrier: text(body.carrier, 'nhà xe', { required: true }),
    recipient: text(body.recipient, 'người nhận'),
    address: text(body.address, 'địa chỉ', { max: 400 }),
    spec: text(body.spec, 'quy cách'),
    ticketFee: money(body.ticketFee, 'Phí vé'),
    transportFee: money(body.transportFee, 'Cước vận chuyển'),
    gateFee: money(body.gateFee, 'Phí cổng'),
    note: text(body.note, 'ghi chú', { max: 1000 }),
    rateVarianceNote: text(body.rateVarianceNote, 'lý do chênh lệch cước', { max: 1000 }),
    misaDocumentDate,
    misaDocumentCode: text(body.misaDocumentCode, 'Số chứng từ MISA', { max: 100 }),
  };
}

function readEmployeeId(db, user, value) {
  if (!canSeeEveryone(user)) {
    const employee = db.prepare(
      'SELECT id FROM employees WHERE user_id = ? AND is_active = 1',
    ).get(user.id);
    if (!employee) {
      throw badRequest('Tài khoản này chưa được liên kết với nhân viên đang hoạt động.');
    }
    return employee.id;
  }
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id)) throw badRequest('Nhân viên không hợp lệ.');
  const employee = db.prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1').get(id);
  if (!employee) throw badRequest('Nhân viên không hoạt động hoặc không tồn tại.');
  return id;
}

function customerForEntry(db, body, customerName) {
  const requestedId = Number(body.customerId);
  const customer = Number.isInteger(requestedId) && requestedId > 0
    ? db.prepare('SELECT * FROM customers WHERE id = ?').get(requestedId)
    : db.prepare('SELECT * FROM customers WHERE customer_key = ?').get(normalizeSearchText(customerName));
  if (!customer) return null;
  if (normalizeSearchText(customer.customer_name) !== normalizeSearchText(customerName)) {
    throw badRequest('Khách hàng không khớp với dữ liệu đã chọn.');
  }
  return customer;
}

function standardTransportRate(db, body, input) {
  const customer = customerForEntry(db, body, input.customer);
  if (!customer) return null;
  const carrier = db.prepare('SELECT id FROM carriers WHERE carrier_key = ?').get(
    normalizeSearchText(input.carrier),
  );
  if (!carrier) return null;
  const specKey = normalizeSearchText(input.spec);
  return db.prepare(
    `SELECT transport_fee
       FROM carrier_customer_rates
      WHERE customer_id = ? AND carrier_id = ?
        AND (spec_key = ? OR is_default = 1)
      ORDER BY CASE WHEN spec_key = ? THEN 0 ELSE 1 END, id
      LIMIT 1`,
  ).get(customer.id, carrier.id, specKey, specKey) ?? null;
}

function ensureVarianceReason(db, body, input) {
  const rate = standardTransportRate(db, body, input);
  if (!rate) return;
  if (input.transportFee <= Number(rate.transport_fee)) {
    input.rateVarianceNote = '';
    return;
  }
  if (!input.rateVarianceNote) {
    throw badRequest('Vui lòng nhập lý do chênh lệch cước với giá thiết lập.');
  }
}

function recipientList(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(/[;,\n]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = normalizeSearchText(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function appendRecipient(existing, next) {
  const values = recipientList(existing);
  const key = normalizeSearchText(next);
  if (key && !values.some((value) => normalizeSearchText(value) === key)) {
    values.push(next);
  }
  return values.join(', ');
}

/** Đồng bộ thông tin giao nhận người dùng vừa chỉnh vào danh mục chuẩn. */
function syncCustomerDelivery(db, body, input, at) {
  const customer = customerForEntry(db, body, input.customer);
  if (!customer) return;

  const carrier = ensureCustomerCarrier(db, customer.id, input.carrier, at);

  const recipients = appendRecipient(customer.recipient, input.recipient);
  db.prepare(
    `UPDATE customers SET recipient = ?, updated_at = ? WHERE id = ?`,
  ).run(recipients, at, customer.id);
  const carriers = refreshCustomerCarrier(db, customer.id, at);
  return { customerId: customer.id, carrierId: carrier?.id ?? null, carriers, recipients };
}

function dateOffset(iso, offset) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatQuantity(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
}

function shortProductName(value) {
  const name = String(value ?? '').trim();
  const match = /\(([^()]+)\)/.exec(name);
  return (match?.[1] ?? name).trim();
}

function toApi(row) {
  return {
    id: row.id,
    entryDate: row.entry_date,
    customer: row.customer,
    carrier: row.carrier,
    recipient: row.recipient,
    address: row.address,
    spec: row.spec,
    ticketFee: row.ticket_fee,
    transportFee: row.transport_fee,
    gateFee: row.gate_fee,
    totalFee: row.total_fee,
    note: row.note,
    rateVarianceNote: row.rate_variance_note,
    misaDocumentDate: row.misa_document_date,
    misaDocumentCode: row.misa_document_code,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    employeeId: row.employee_id ?? null,
    employeeName: row.employee_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Đọc một phiếu và kiểm tra quyền chạm vào nó.
 * Nhân viên chỉ được sửa/xóa phiếu do chính mình tạo.
 */
function loadOwned(db, user, id) {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!row) throw notFound('Không tìm thấy phiếu.');
  if (!canSeeEveryone(user) && row.created_by !== user.id) {
    // Cùng thông báo với "không tìm thấy" để không lộ sự tồn tại của phiếu.
    throw notFound('Không tìm thấy phiếu.');
  }
  return row;
}

// ---------------------------------------------------------------- route

function register(router) {
  router.get('/api/entries', async (c) => {
    c.requirePage(PAGE);

    const params = [];
    const where = ['1 = 1'];

    // Chốt chặn quan trọng nhất: nhân viên luôn bị ghép thêm điều kiện này,
    // bất kể giao diện gửi lên cái gì.
    if (!canSeeEveryone(c.user)) {
      where.push('e.created_by = ?');
      params.push(c.user.id);
    } else if (c.query.createdBy) {
      where.push('e.created_by = ?');
      params.push(Number(c.query.createdBy));
    }

    if (canSeeEveryone(c.user) && c.query.employeeId) {
      const employeeId = Number(c.query.employeeId);
      if (!Number.isInteger(employeeId) || employeeId < 1) {
        throw badRequest('Nhân viên phụ trách không hợp lệ.');
      }
      where.push('e.employee_id = ?');
      params.push(employeeId);
    }

    if (DATE_PATTERN.test(c.query.from ?? '')) {
      where.push('e.entry_date >= ?');
      params.push(c.query.from);
    }
    if (DATE_PATTERN.test(c.query.to ?? '')) {
      where.push('e.entry_date <= ?');
      params.push(c.query.to);
    }
    if (c.query.search) {
      where.push('(e.customer LIKE ? OR e.carrier LIKE ? OR e.recipient LIKE ?)');
      const like = `%${String(c.query.search).slice(0, 100)}%`;
      params.push(like, like, like);
    }

    const clause = where.join(' AND ');
    const limit = Math.min(Number(c.query.limit) || 200, MAX_LIMIT);

    const rows = c.db
      .prepare(
      `SELECT e.*, u.full_name AS created_by_name, employees.full_name AS employee_name
           FROM entries e JOIN users u ON u.id = e.created_by
           LEFT JOIN employees ON employees.id = e.employee_id
          WHERE ${clause}
          ORDER BY e.entry_date DESC, e.id DESC
          LIMIT ?`,
      )
      .all(...params, limit);

    const summary = c.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(e.total_fee), 0) AS total
           FROM entries e WHERE ${clause}`,
      )
      .get(...params);

    return {
      items: rows.map(toApi),
      count: Number(summary.count),
      total: Number(summary.total),
      scope: canSeeEveryone(c.user) ? 'all' : 'own',
    };
  });

  router.get('/api/entries/form-options', async (c) => {
    c.requirePage(PAGE);
    const customers = c.db.prepare(
      `SELECT customers.id, customers.customer_name,
              COALESCE((
                SELECT province_city FROM misa_rows
                 WHERE misa_rows.customer_key = customers.customer_key
                   AND province_city <> ''
                 ORDER BY document_date DESC, id DESC LIMIT 1
              ), '') AS province_city
         FROM customers
        ORDER BY customers.customer_name COLLATE NOCASE, customers.id`,
    ).all();
    const employees = c.db.prepare(
      `SELECT employees.id, employees.user_id, employees.full_name
       FROM employees
       WHERE employees.is_active = 1
       ORDER BY employees.full_name COLLATE NOCASE, employees.id`,
    ).all();
    const carriers = c.db.prepare(
      `SELECT id, name FROM carriers
       WHERE is_active = 1
       ORDER BY name COLLATE NOCASE, id`,
    ).all();
    return {
      currentUserId: c.user.id,
      currentUserName: c.user.full_name,
      isAdmin: canSeeEveryone(c.user),
      customers: customers.map((row) => ({
        id: row.id, name: row.customer_name, provinceCity: row.province_city,
      })),
      carriers: carriers.map((row) => ({ id: row.id, name: row.name })),
      employees: employees.map((row) => ({ id: row.id, userId: row.user_id, name: row.full_name })),
    };
  });

  router.get('/api/entries/customer-context', async (c) => {
    c.requirePage(PAGE);
    const customerId = Number(c.query.customerId);
    const customer = c.db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) throw notFound('Không tìm thấy khách hàng.');
    const carriers = c.db.prepare(
      `SELECT carriers.id, carriers.name
       FROM carrier_customers INNER JOIN carriers ON carriers.id = carrier_customers.carrier_id
       WHERE carrier_customers.customer_id = ? AND carriers.is_active = 1
       ORDER BY carriers.name COLLATE NOCASE, carriers.id`,
    ).all(customer.id);
    const preferred = carriers.find((carrier) =>
      normalizeSearchText(carrier.name) === normalizeSearchText(customer.carrier),
    );
    return {
      customer: {
        id: customer.id,
        name: customer.customer_name,
        recipient: customer.recipient,
        address: customer.address,
      },
      carriers,
	  recipients: recipientList(customer.recipient),
      defaultCarrierId: preferred?.id ?? (carriers.length === 1 ? carriers[0].id : null),
    };
  });

  router.get('/api/entries/misa-orders', async (c) => {
    c.requirePage(PAGE);
    const customerId = Number(c.query.customerId);
    const endDate = String(c.query.endDate ?? '').trim();
    if (!DATE_PATTERN.test(endDate)) throw badRequest('Ngày gửi không hợp lệ.');
    const customer = c.db.prepare('SELECT customer_name FROM customers WHERE id = ?').get(customerId);
    if (!customer) throw notFound('Không tìm thấy khách hàng.');
    const rows = c.db.prepare(
      `SELECT document_date, product_name, SUM(quantity_sold) AS quantity
       FROM misa_rows
       WHERE document_date BETWEEN ? AND ? AND customer_key = ?
         AND vn_normalize(product_name) <> 'nhiet ke'
       GROUP BY document_date, product_name
       ORDER BY document_date DESC, product_name COLLATE NOCASE`,
    ).all(dateOffset(endDate, -19), endDate, normalizeSearchText(customer.customer_name));
    const groups = new Map();
    for (const row of rows) {
      const key = row.document_date;
      const items = groups.get(key)?.items ?? [];
      items.push({ productName: row.product_name, quantity: Number(row.quantity) });
      groups.set(key, { documentDate: row.document_date, documentCode: '', items });
    }
    return {
      items: [...groups.values()].map(({ documentDate, documentCode, items }) => ({
        documentDate,
        documentCode,
        items,
        totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
        note: items.map((item) => `${formatQuantity(item.quantity)} ${shortProductName(item.productName)}`).join(' + '),
      })),
    };
  });

  router.get('/api/entries/rates', async (c) => {
    c.requirePage(PAGE);
    const customerId = Number(c.query.customerId);
    const carrierId = Number(c.query.carrierId);
    const assigned = c.db.prepare(
      'SELECT 1 FROM carrier_customers WHERE carrier_id = ? AND customer_id = ?',
    ).get(carrierId, customerId);
    if (!assigned) throw badRequest('Nhà xe chưa được gán cho khách hàng này.');
    const rows = c.db.prepare(
      `SELECT id, spec, is_default, transport_fee, gate_fee, note
       FROM carrier_customer_rates WHERE carrier_id = ? AND customer_id = ?
       ORDER BY is_default ASC, spec COLLATE NOCASE, id`,
    ).all(carrierId, customerId);
    return { items: rows.map((row) => ({
      id: row.id, spec: row.spec, isDefault: Boolean(row.is_default),
      transportFee: row.transport_fee, gateFee: row.gate_fee, note: row.note,
    })) };
  });

  router.post('/api/entries', async (c) => {
    c.requirePage(PAGE);
    const input = readEntryInput(c.body);
    const employeeId = readEmployeeId(c.db, c.user, c.body.employeeId);
    ensureVarianceReason(c.db, c.body, input);
    const at = new Date().toISOString();

    return transaction(c.db, () => {
		const delivery = syncCustomerDelivery(c.db, c.body, input, at);
      const result = c.db
        .prepare(
          `INSERT INTO entries
             (entry_date, customer, carrier, recipient, address, spec,
              ticket_fee, transport_fee, gate_fee, note, rate_variance_note, misa_document_date, misa_document_code, employee_id,
              created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.entryDate,
          input.customer,
          input.carrier,
          input.recipient,
          input.address,
          input.spec,
          input.ticketFee,
          input.transportFee,
          input.gateFee,
          input.note,
          input.rateVarianceNote,
          input.misaDocumentDate,
          input.misaDocumentCode,
          employeeId,
          c.user.id,
          at,
          at,
        );
      const id = Number(result.lastInsertRowid);
		writeAudit(c.db, c.user, 'entry.create', 'entry', id, { ...input, employeeId, delivery });
      const row = c.db
        .prepare(
          `SELECT e.*, u.full_name AS created_by_name, employees.full_name AS employee_name
             FROM entries e JOIN users u ON u.id = e.created_by
             LEFT JOIN employees ON employees.id = e.employee_id WHERE e.id = ?`,
        )
        .get(id);
      return toApi(row);
    });
  });

  router.patch('/api/entries/:id', async (c) => {
    c.requirePage(PAGE);
    const before = loadOwned(c.db, c.user, Number(c.params.id));
    const input = readEntryInput(c.body);
    const employeeId = canSeeEveryone(c.user)
      ? readEmployeeId(c.db, c.user, c.body.employeeId)
      : before.employee_id;
    ensureVarianceReason(c.db, c.body, input);
    return transaction(c.db, () => {
		const delivery = syncCustomerDelivery(c.db, c.body, input, new Date().toISOString());
      c.db
        .prepare(
          `UPDATE entries SET
             entry_date = ?, customer = ?, carrier = ?, recipient = ?,
             address = ?, spec = ?, ticket_fee = ?, transport_fee = ?,
             gate_fee = ?, note = ?, rate_variance_note = ?, misa_document_date = ?, misa_document_code = ?, employee_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.entryDate,
          input.customer,
          input.carrier,
          input.recipient,
          input.address,
          input.spec,
          input.ticketFee,
          input.transportFee,
          input.gateFee,
          input.note,
          input.rateVarianceNote,
          input.misaDocumentDate,
          input.misaDocumentCode,
          employeeId,
          new Date().toISOString(),
          before.id,
        );
      writeAudit(c.db, c.user, 'entry.update', 'entry', before.id, {
        before: toApi(before),
        after: input,
		delivery,
      });
      const row = c.db
        .prepare(
          `SELECT e.*, u.full_name AS created_by_name, employees.full_name AS employee_name
             FROM entries e JOIN users u ON u.id = e.created_by
             LEFT JOIN employees ON employees.id = e.employee_id WHERE e.id = ?`,
        )
        .get(before.id);
      return toApi(row);
    });
  });

  router.delete('/api/entries/:id', async (c) => {
    c.requirePage(PAGE);
    const row = loadOwned(c.db, c.user, Number(c.params.id));
    return transaction(c.db, () => {
      c.db.prepare('DELETE FROM entries WHERE id = ?').run(row.id);
      writeAudit(c.db, c.user, 'entry.delete', 'entry', row.id, toApi(row));
      return { ok: true };
    });
  });
}

module.exports = { register };
