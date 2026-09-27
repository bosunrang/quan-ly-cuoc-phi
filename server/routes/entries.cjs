'use strict';

const { normalizeSearchText, transaction } = require('../db.cjs');
const { ensureCustomerCarrier, refreshCustomerCarrier } = require('../carrier-links.cjs');
const { writeAudit } = require('../audit.cjs');
const { canSeeEveryone } = require('../permissions.cjs');
const { badRequest, conflict, notFound, isIsoDate } = require('../http.cjs');

const PAGE = 'entries';
const MAX_LIMIT = 500;
const DEFAULT_SPEC_KEY = '__all__';
const BILL_STATUSES = new Set(['', 'Có bill', 'Không bill']);

// ---------------------------------------------------------------- kiểm tra

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

function billStatus(value) {
  const result = text(value, 'Bill', { max: 20, required: true });
  if (!BILL_STATUSES.has(result)) throw badRequest('Bill chỉ được chọn Có bill hoặc Không bill.');
  return result;
}

function readEntryInput(body) {
  const entryDate = String(body.entryDate ?? '').trim();
  if (!isIsoDate(entryDate)) {
    throw badRequest('Ngày không hợp lệ (cần dạng YYYY-MM-DD).');
  }
  const misaDocumentDate = text(body.misaDocumentDate, 'Ngày chứng từ MISA', { max: 10 });
  if (misaDocumentDate && !isIsoDate(misaDocumentDate)) {
    throw badRequest('Ngày chứng từ MISA không hợp lệ.');
  }
  const transportFee = money(body.transportFee, 'Cước vận chuyển');
  if (transportFee === 0) {
    throw badRequest('Vui lòng nhập cước vận chuyển lớn hơn 0.');
  }
  return {
    entryDate,
    customer: text(body.customer, 'tên khách hàng', { required: true }),
    carrier: text(body.carrier, 'nhà xe', { required: true }),
    recipient: text(body.recipient, 'người nhận', { required: true }),
    address: text(body.address, 'địa chỉ', { max: 400 }),
    spec: text(body.spec, 'quy cách', { required: true }),
    ticketFee: money(body.ticketFee, 'Phí vé'),
    transportFee,
    gateFee: money(body.gateFee, 'Phí cổng'),
    note: text(body.note, 'sản phẩm', { max: 1000, required: true }),
    rateVarianceNote: text(body.rateVarianceNote, 'lý do chênh lệch cước', { max: 1000 }),
    duplicateReason: text(body.duplicateReason, 'lý do nhập trùng', { max: 1000 }),
    billStatus: billStatus(body.billStatus),
    misaDocumentDate,
    misaDocumentCode: text(body.misaDocumentCode, 'Số chứng từ MISA', { max: 100 }),
  };
}

/**
 * Nhân viên gửi lại cùng ngày cho cùng khách hàng thường là nhập nhầm hai lần.
 * Vẫn cho phép lưu khi có giải trình, không xét danh sách mặt hàng.
 */
function ensureDuplicateReason(db, input, excludedEntryId = 0) {
  const duplicate = db.prepare(
    `SELECT id FROM entries
      WHERE entry_date = ?
        AND vn_normalize(customer) = ?
        AND id <> ?
      ORDER BY id DESC
      LIMIT 1`,
  ).get(
    input.entryDate,
    normalizeSearchText(input.customer),
    excludedEntryId,
  );
  if (!duplicate) {
    input.duplicateReason = '';
    return;
  }
  if (!input.duplicateReason) {
    throw conflict(
      'Đã có phiếu cùng ngày gửi và khách hàng. Vui lòng nhập lý do nếu vẫn cần lưu phiếu này.',
    );
  }
}

/** Quản trị viên được quyền chủ động lưu phiếu trùng; nhân viên thì phải giải trình. */
function ensureStaffDuplicateReason(db, user, input, excludedEntryId = 0) {
  if (!canSeeEveryone(user)) ensureDuplicateReason(db, input, excludedEntryId);
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
  if (value === null || value === undefined || value === '') {
    throw badRequest('Vui lòng chọn nhân viên phụ trách.');
  }
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
	// Khi người dùng chủ động lưu lại bảng cước, mức vừa nhập sẽ trở thành giá chuẩn.
	if (body.saveCarrierRate === true) {
		input.rateVarianceNote = '';
		return;
	}
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

function ensureCarrierRateSavingPermission(user, body) {
  if (body.saveCarrierRate === true && !canSeeEveryone(user)) {
    throw badRequest('Chỉ quản trị viên được lưu bảng cước nhà xe.');
  }
}

/** Nhân viên chỉ được lập phiếu theo quy cách đã có trong bảng giá của Admin. */
function ensureStaffUsesConfiguredRate(db, user, body, input) {
  if (canSeeEveryone(user)) return;
  if (!input.spec) {
    throw badRequest('Vui lòng chọn quy cách đã được quản trị viên thiết lập.');
  }
  const customer = customerForEntry(db, body, input.customer);
  const carrier = db.prepare('SELECT id FROM carriers WHERE carrier_key = ?').get(
    normalizeSearchText(input.carrier),
  );
  if (!customer || !carrier) {
    throw badRequest('Vui lòng chọn khách hàng và nhà xe có bảng cước đã thiết lập.');
  }
  const specKey = normalizeSearchText(input.spec);
  const configuredRate = db.prepare(
    `SELECT 1 FROM carrier_customer_rates rate
       INNER JOIN carrier_customers assignment
         ON assignment.customer_id = rate.customer_id
        AND assignment.carrier_id = rate.carrier_id
      WHERE rate.customer_id = ? AND rate.carrier_id = ?
        AND (rate.spec_key = ? OR (rate.is_default = 1 AND ? = 'tat ca'))
      LIMIT 1`,
  ).get(customer.id, carrier.id, specKey, specKey);
  if (!configuredRate) {
    throw badRequest('Quy cách chưa được quản trị viên thiết lập cho khách hàng và nhà xe này.');
  }
}

/** Lưu hoặc cập nhật đúng một quy cách của cặp khách hàng – nhà xe. */
function saveCarrierRate(db, user, customerId, carrierId, input, at) {
  if (!input.spec) {
    throw badRequest('Vui lòng chọn hoặc nhập quy cách để lưu vào bảng cước nhà xe.');
  }
  const isDefault = normalizeSearchText(input.spec) === 'tat ca';
  const spec = isDefault ? 'Tất cả' : input.spec;
  const specKey = isDefault ? DEFAULT_SPEC_KEY : normalizeSearchText(spec);
  const before = db.prepare(
    `SELECT * FROM carrier_customer_rates
      WHERE carrier_id = ? AND customer_id = ? AND spec_key = ?`,
  ).get(carrierId, customerId, specKey);
  db.prepare(
    `INSERT INTO carrier_customer_rates
       (carrier_id, customer_id, spec, spec_key, is_default, transport_fee, gate_fee, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
     ON CONFLICT(carrier_id, customer_id, spec_key) DO UPDATE SET
       spec = excluded.spec,
       is_default = excluded.is_default,
       transport_fee = excluded.transport_fee,
       gate_fee = excluded.gate_fee,
       updated_at = excluded.updated_at`,
  ).run(
    carrierId, customerId, spec, specKey, Number(isDefault),
    input.transportFee, input.gateFee, at, at,
  );
  const rate = db.prepare(
    `SELECT * FROM carrier_customer_rates
      WHERE carrier_id = ? AND customer_id = ? AND spec_key = ?`,
  ).get(carrierId, customerId, specKey);
  writeAudit(
    db,
    user,
    before ? 'carrier.rate.update_from_entry' : 'carrier.rate.create_from_entry',
    'carrier_customer_rate',
    rate.id,
    { carrierId, customerId, before, after: rate },
  );
  return { id: rate.id, spec: rate.spec, transportFee: rate.transport_fee, gateFee: rate.gate_fee };
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
function syncCustomerDelivery(db, user, body, input, at) {
  const customer = customerForEntry(db, body, input.customer);
  if (!customer) return;

  const carrier = ensureCustomerCarrier(db, customer.id, input.carrier, at);

  const recipients = appendRecipient(customer.recipient, input.recipient);
  db.prepare(
    `UPDATE customers SET recipient = ?, updated_at = ? WHERE id = ?`,
  ).run(recipients, at, customer.id);
  const carriers = refreshCustomerCarrier(db, customer.id, at);
  const rate = body.saveCarrierRate === true && carrier
    ? saveCarrierRate(db, user, customer.id, carrier.id, input, at)
    : null;
  return { customerId: customer.id, carrierId: carrier?.id ?? null, carriers, recipients, rate };
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
    standardTransportFee: row.standard_transport_fee == null
      ? null
      : Number(row.standard_transport_fee),
    gateFee: row.gate_fee,
    totalFee: row.total_fee,
    note: row.note,
    rateVarianceNote: row.rate_variance_note,
    duplicateReason: row.duplicate_reason,
    billStatus: row.bill_status || '',
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

const STANDARD_TRANSPORT_RATE_SELECT = `(
  SELECT rate.transport_fee
    FROM customers customer
    INNER JOIN carriers carrier
      ON carrier.carrier_key = vn_normalize(e.carrier)
    INNER JOIN carrier_customer_rates rate
      ON rate.customer_id = customer.id AND rate.carrier_id = carrier.id
   WHERE customer.customer_key = vn_normalize(e.customer)
     AND (rate.spec_key = vn_normalize(e.spec) OR rate.is_default = 1)
   ORDER BY CASE WHEN rate.spec_key = vn_normalize(e.spec) THEN 0 ELSE 1 END,
            rate.id
   LIMIT 1
) AS standard_transport_fee`;

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

    if (c.query.from && !isIsoDate(c.query.from)) {
      throw badRequest('Từ ngày không hợp lệ.');
    }
    if (c.query.from) {
      where.push('e.entry_date >= ?');
      params.push(c.query.from);
    }
    if (c.query.to && !isIsoDate(c.query.to)) {
      throw badRequest('Đến ngày không hợp lệ.');
    }
    if (c.query.to) {
      where.push('e.entry_date <= ?');
      params.push(c.query.to);
    }
    if (c.query.search) {
      where.push('(e.customer LIKE ? OR e.carrier LIKE ? OR e.recipient LIKE ?)');
      const like = `%${String(c.query.search).slice(0, 100)}%`;
      params.push(like, like, like);
    }

    const clause = where.join(' AND ');
    const limit = Math.min(Math.max(Number(c.query.limit) || 25, 1), MAX_LIMIT);
    const offset = Math.max(Number(c.query.offset) || 0, 0);

    const rows = c.db
      .prepare(
      `SELECT e.*, u.full_name AS created_by_name, employees.full_name AS employee_name,
              ${STANDARD_TRANSPORT_RATE_SELECT}
           FROM entries e JOIN users u ON u.id = e.created_by
           LEFT JOIN employees ON employees.id = e.employee_id
          WHERE ${clause}
          ORDER BY e.entry_date DESC, e.id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

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

  // Chỉ trả về cờ cảnh báo, không làm lộ phiếu của người khác. Nhân viên cần
  // thấy ngay ô giải trình khi trùng ngày gửi và khách hàng; Admin được phép
  // chủ động lưu nên không bị nhắc cảnh báo này.
  router.get('/api/entries/duplicate-check', async (c) => {
    c.requirePage(PAGE);
    const entryDate = String(c.query.entryDate ?? '').trim();
    const customer = String(c.query.customer ?? '').trim();
    const excludedEntryId = Number(c.query.excludeId) || 0;
    if (
      canSeeEveryone(c.user) ||
      !isIsoDate(entryDate) ||
      !customer ||
      !Number.isInteger(excludedEntryId) ||
      excludedEntryId < 0
    ) {
      return { duplicate: false };
    }
    const duplicate = c.db.prepare(
      `SELECT 1 FROM entries
        WHERE entry_date = ?
          AND vn_normalize(customer) = ?
          AND id <> ?
        LIMIT 1`,
    ).get(entryDate, normalizeSearchText(customer), excludedEntryId);
    return { duplicate: Boolean(duplicate) };
  });

  router.get('/api/entries/form-options', async (c) => {
    c.requirePage(PAGE);
    const customers = c.db.prepare(
      `SELECT customers.id, customers.customer_name,
              COALESCE(NULLIF(customers.customer_code, ''), (
                SELECT customer_code FROM misa_rows
                 WHERE misa_rows.customer_key = customers.customer_key
                   AND customer_code <> ''
                 ORDER BY document_date DESC, id DESC LIMIT 1
              ), '') AS customer_code,
              COALESCE(
                (
                  SELECT province_city FROM misa_rows
                   WHERE customers.customer_code <> ''
                     AND misa_rows.customer_code = customers.customer_code COLLATE NOCASE
                     AND province_city <> ''
                   ORDER BY document_date DESC, id DESC LIMIT 1
                ),
                (
                  SELECT province_city FROM misa_rows
                   WHERE misa_rows.customer_key = customers.customer_key
                     AND province_city <> ''
                   ORDER BY document_date DESC, id DESC LIMIT 1
                ),
                ''
              ) AS province_city
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
        id: row.id,
        name: row.customer_name,
        customerCode: row.customer_code,
        provinceCity: row.province_city,
      })),
      carriers: canSeeEveryone(c.user)
        ? carriers.map((row) => ({ id: row.id, name: row.name }))
        : [],
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
    if (!isIsoDate(endDate)) throw badRequest('Ngày gửi không hợp lệ.');
    const customer = c.db.prepare(
      'SELECT customer_name, customer_code FROM customers WHERE id = ?',
    ).get(customerId);
    if (!customer) throw notFound('Không tìm thấy khách hàng.');
    const readRowsBy = (column, value) => c.db.prepare(
      `SELECT document_date, product_name, SUM(quantity_sold) AS quantity
       FROM misa_rows
       WHERE document_date BETWEEN ? AND ? AND ${column} = ? COLLATE NOCASE
         AND vn_normalize(product_name) <> 'nhiet ke'
       GROUP BY document_date, product_name
       ORDER BY document_date DESC, product_name COLLATE NOCASE`,
    ).all(dateOffset(endDate, -19), endDate, value);
    // Mã khách hàng là khóa liên kết ổn định với MISA. Chỉ quay về
    // so khớp tên cho dữ liệu cũ/chưa có mã, hoặc khi mã chưa tồn tại trong MISA.
    let rows = customer.customer_code
      ? readRowsBy('customer_code', customer.customer_code)
      : [];
    if (!rows.length) {
      rows = readRowsBy('customer_key', normalizeSearchText(customer.customer_name));
    }
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
	ensureCarrierRateSavingPermission(c.user, c.body);
    const input = readEntryInput(c.body);
    const employeeId = readEmployeeId(c.db, c.user, c.body.employeeId);
	ensureStaffUsesConfiguredRate(c.db, c.user, c.body, input);
    ensureVarianceReason(c.db, c.body, input);
    const at = new Date().toISOString();

    return transaction(c.db, () => {
		ensureStaffDuplicateReason(c.db, c.user, input);
		const delivery = syncCustomerDelivery(c.db, c.user, c.body, input, at);
      const result = c.db
        .prepare(
          `INSERT INTO entries
             (entry_date, customer, carrier, recipient, address, spec,
              ticket_fee, transport_fee, gate_fee, note, rate_variance_note, duplicate_reason, bill_status, misa_document_date, misa_document_code, employee_id,
              created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.duplicateReason,
          input.billStatus,
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
          `SELECT e.*, u.full_name AS created_by_name, employees.full_name AS employee_name,
                  ${STANDARD_TRANSPORT_RATE_SELECT}
             FROM entries e JOIN users u ON u.id = e.created_by
             LEFT JOIN employees ON employees.id = e.employee_id WHERE e.id = ?`,
        )
        .get(id);
      return toApi(row);
    });
  });

  router.patch('/api/entries/:id', async (c) => {
    c.requirePage(PAGE);
	ensureCarrierRateSavingPermission(c.user, c.body);
    const before = loadOwned(c.db, c.user, Number(c.params.id));
    const input = readEntryInput(c.body);
	ensureStaffUsesConfiguredRate(c.db, c.user, c.body, input);
    const employeeId = canSeeEveryone(c.user)
      ? readEmployeeId(c.db, c.user, c.body.employeeId)
      : before.employee_id;
    ensureVarianceReason(c.db, c.body, input);
    return transaction(c.db, () => {
		ensureStaffDuplicateReason(c.db, c.user, input, before.id);
		const delivery = syncCustomerDelivery(c.db, c.user, c.body, input, new Date().toISOString());
      c.db
        .prepare(
          `UPDATE entries SET
             entry_date = ?, customer = ?, carrier = ?, recipient = ?,
             address = ?, spec = ?, ticket_fee = ?, transport_fee = ?,
             gate_fee = ?, note = ?, rate_variance_note = ?, duplicate_reason = ?, bill_status = ?, misa_document_date = ?, misa_document_code = ?, employee_id = ?, updated_at = ?
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
          input.duplicateReason,
          input.billStatus,
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
          `SELECT e.*, u.full_name AS created_by_name, employees.full_name AS employee_name,
                  ${STANDARD_TRANSPORT_RATE_SELECT}
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
