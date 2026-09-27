'use strict';

const { normalizeSearchText, transaction } = require('../db.cjs');
const { ensureCustomerCarrier, refreshCustomerCarrier } = require('../carrier-links.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest, notFound } = require('../http.cjs');

const PAGE = 'carriers';
const DEFAULT_SPEC_KEY = '__all__';
const MAX_EXCEL_ROWS = 5_000;

function text(value, field, { max = 300, required = false } = {}) {
  const result = String(value ?? '').trim();
  if (required && !result) throw badRequest(`Vui lòng nhập ${field}.`);
  if (result.length > max) throw badRequest(`${field} không được dài quá ${max} ký tự.`);
  return result;
}

function readInput(body) {
  const name = text(body.name, 'tên nhà xe', { required: true });
  return {
    name,
    contact: text(body.contact, 'người liên hệ'),
    phone: text(body.phone, 'số điện thoại', { max: 60 }),
    address: text(body.address, 'địa chỉ', { max: 500 }),
    schedule: text(body.schedule, 'giờ xe chạy', { max: 300 }),
    note: text(body.note, 'ghi chú', { max: 1000 }),
    isActive: body.isActive !== false,
    key: normalizeSearchText(name),
  };
}

function money(value, field) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) {
    throw badRequest(`${field} phải là số nguyên không âm.`);
  }
  return result;
}

function readRateInput(body) {
  const isDefault = body.isDefault === true;
  const spec = isDefault ? 'Tất cả' : text(body.spec, 'quy cách', { required: true, max: 200 });
  return {
    spec,
    specKey: isDefault ? DEFAULT_SPEC_KEY : normalizeSearchText(spec),
    isDefault,
    transportFee: money(body.transportFee, 'Cước vận chuyển'),
    gateFee: money(body.gateFee, 'Phí vào cổng'),
    note: text(body.note, 'ghi chú', { max: 1000 }),
  };
}

function excelRows(value, label) {
  if (!Array.isArray(value)) throw badRequest(`${label} không hợp lệ.`);
  if (value.length > MAX_EXCEL_ROWS) {
    throw badRequest(`Mỗi sheet chỉ được nhập tối đa ${MAX_EXCEL_ROWS.toLocaleString('vi-VN')} dòng.`);
  }
  return value;
}

function readExcelCarrier(row) {
  return readInput({
    name: row?.name,
    address: row?.address,
    phone: row?.phone,
    schedule: row?.schedule,
    note: row?.note,
    isActive: row?.isActive,
  });
}

function readExcelRate(row) {
  const carrierName = text(row?.carrierName, 'nhà xe', { required: true });
  const customerName = text(row?.customerName, 'đơn vị', { required: true });
  const input = readRateInput({
    spec: row?.spec,
    isDefault: normalizeSearchText(row?.spec) === 'tat ca',
    transportFee: row?.transportFee,
    gateFee: row?.gateFee,
    note: row?.note,
  });
  return { carrierName, customerName, ...input };
}

function prepareExcelImport(db, body) {
  const carrierRows = excelRows(body.carriers, 'Sheet Nhà xe');
  const rateRows = excelRows(body.rates, 'Sheet Bảng cước');
  const existingCarriers = new Map(
    db.prepare('SELECT id, name, carrier_key FROM carriers').all()
      .map((row) => [row.carrier_key, row]),
  );
  const customers = new Map(
    db.prepare('SELECT id, customer_key FROM customers').all()
      .map((row) => [row.customer_key, row]),
  );
  const existingRates = new Set(
    db.prepare(
      `SELECT carriers.carrier_key, carrier_customer_rates.customer_id, carrier_customer_rates.spec_key
         FROM carrier_customer_rates
         INNER JOIN carriers ON carriers.id = carrier_customer_rates.carrier_id`,
    ).all().map((row) => `${row.carrier_key}|${row.customer_id}|${row.spec_key}`),
  );
  const carrierKeys = new Set();
  const carriers = carrierRows.map((row, index) => {
    try {
      const input = readExcelCarrier(row);
      if (carrierKeys.has(input.key)) {
        return { rowNumber: Number(row?.rowNumber) || index + 2, status: 'skipped', reason: 'Nhà xe trùng trong file' };
      }
      carrierKeys.add(input.key);
      return {
        rowNumber: Number(row?.rowNumber) || index + 2,
        status: existingCarriers.has(input.key) ? 'duplicate' : 'ready',
        reason: existingCarriers.has(input.key) ? 'Nhà xe đã tồn tại' : undefined,
        ...input,
      };
    } catch (error) {
      return {
        rowNumber: Number(row?.rowNumber) || index + 2,
        status: 'skipped',
        reason: error.message,
      };
    }
  });
  const rateKeys = new Set();
  const rates = rateRows.map((row, index) => {
    try {
      const input = readExcelRate(row);
      const customer = customers.get(normalizeSearchText(input.customerName));
      if (!customer) {
        return { rowNumber: Number(row?.rowNumber) || index + 2, status: 'skipped', reason: 'Chưa có đơn vị trong danh mục', ...input };
      }
      const carrierKey = normalizeSearchText(input.carrierName);
      const key = `${carrierKey}|${customer.id}|${input.specKey}`;
      if (rateKeys.has(key)) {
        return { rowNumber: Number(row?.rowNumber) || index + 2, status: 'skipped', reason: 'Mức cước trùng trong file', ...input };
      }
      rateKeys.add(key);
      return {
        rowNumber: Number(row?.rowNumber) || index + 2,
        status: existingRates.has(key) ? 'duplicate' : 'ready',
        reason: existingRates.has(key) ? 'Mức cước đã tồn tại' : undefined,
        customerId: customer.id,
        carrierKey,
        ...input,
      };
    } catch (error) {
      return {
        rowNumber: Number(row?.rowNumber) || index + 2,
        status: 'skipped',
        reason: error.message,
      };
    }
  });
  return {
    carriers,
    rates,
    carrierSummary: {
      ready: carriers.filter((row) => row.status === 'ready').length,
      duplicate: carriers.filter((row) => row.status === 'duplicate').length,
      skipped: carriers.filter((row) => row.status === 'skipped').length,
    },
    rateSummary: {
      ready: rates.filter((row) => row.status === 'ready').length,
      duplicate: rates.filter((row) => row.status === 'duplicate').length,
      skipped: rates.filter((row) => row.status === 'skipped').length,
    },
  };
}

function toApi(row, assignedCustomerIds = []) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    phone: row.phone,
    address: row.address,
    schedule: row.schedule,
    note: row.note,
    isActive: Boolean(row.is_active),
    assignedCustomerIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCustomerApi(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerCode: row.customer_code,
    carrier: row.carrier,
    recipient: row.recipient,
    address: row.address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function load(db, id) {
  const row = db.prepare('SELECT * FROM carriers WHERE id = ?').get(id);
  if (!row) throw notFound('Không tìm thấy nhà xe.');
  return row;
}

function ensureAssignment(db, carrierId, customerId) {
  const row = db.prepare(
    'SELECT 1 FROM carrier_customers WHERE carrier_id = ? AND customer_id = ?',
  ).get(carrierId, customerId);
  if (!row) throw badRequest('Khách hàng này chưa được gán cho nhà xe.');
}

function toRateApi(row) {
  return {
    id: row.id,
    spec: row.spec,
    isDefault: Boolean(row.is_default),
    transportFee: row.transport_fee,
    gateFee: row.gate_fee,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueConstraint(error) {
  return error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' || error?.errcode === 2067;
}

function ensureAvailable(db, key, ignoreId = null) {
  const row = ignoreId
    ? db.prepare('SELECT id FROM carriers WHERE carrier_key = ? AND id <> ?').get(key, ignoreId)
    : db.prepare('SELECT id FROM carriers WHERE carrier_key = ?').get(key);
  if (row) throw badRequest('Tên nhà xe này đã có trong danh sách.');
}

function carrierIds(db) {
  const links = db.prepare('SELECT carrier_id, customer_id FROM carrier_customers').all();
  const result = new Map();
  for (const link of links) {
    const ids = result.get(link.carrier_id) ?? [];
    ids.push(link.customer_id);
    result.set(link.carrier_id, ids);
  }
  return result;
}

function register(router) {
  router.get('/api/carriers/excel-export', async (c) => {
    c.requirePage(PAGE);
    const carriers = c.db.prepare(
      `SELECT name, address, phone, schedule, note, is_active
         FROM carriers ORDER BY name COLLATE NOCASE, id`,
    ).all();
    const rates = c.db.prepare(
      `SELECT carriers.name AS carrier_name, customers.customer_name, carrier_customer_rates.spec,
              carrier_customer_rates.transport_fee, carrier_customer_rates.gate_fee, carrier_customer_rates.note
         FROM carrier_customer_rates
         INNER JOIN carriers ON carriers.id = carrier_customer_rates.carrier_id
         INNER JOIN customers ON customers.id = carrier_customer_rates.customer_id
        ORDER BY carriers.name COLLATE NOCASE, customers.customer_name COLLATE NOCASE,
                 carrier_customer_rates.is_default ASC, carrier_customer_rates.spec COLLATE NOCASE`,
    ).all();
    return {
      carriers: carriers.map((row) => ({
        name: row.name,
        address: row.address,
        phone: row.phone,
        schedule: row.schedule,
        note: row.note,
        isActive: Boolean(row.is_active),
      })),
      rates: rates.map((row) => ({
        carrierName: row.carrier_name,
        customerName: row.customer_name,
        spec: row.spec,
        transportFee: row.transport_fee,
        gateFee: row.gate_fee,
        note: row.note,
      })),
    };
  });

  router.post('/api/carriers/excel/preview', async (c) => {
    c.requirePage(PAGE);
    return prepareExcelImport(c.db, c.body);
  });

  router.post('/api/carriers/excel/import', async (c) => {
    c.requirePage(PAGE);
    const preview = prepareExcelImport(c.db, c.body);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      const carrierIds = new Map(
        c.db.prepare('SELECT id, carrier_key FROM carriers').all()
          .map((row) => [row.carrier_key, row.id]),
      );
      const createCarrier = c.db.prepare(
        `INSERT INTO carriers
           (name, contact, phone, address, schedule, note, is_active, carrier_key, created_at, updated_at)
         VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const carrier of preview.carriers) {
        if (carrier.status !== 'ready') continue;
        const existingId = carrierIds.get(carrier.key);
        if (!existingId) {
          const result = createCarrier.run(carrier.name, carrier.phone, carrier.address, carrier.schedule, carrier.note, Number(carrier.isActive), carrier.key, at, at);
          carrierIds.set(carrier.key, Number(result.lastInsertRowid));
        }
      }
      const assign = c.db.prepare(
        `INSERT INTO carrier_customers (carrier_id, customer_id, assigned_at)
         VALUES (?, ?, ?) ON CONFLICT(carrier_id, customer_id) DO NOTHING`,
      );
      const upsertRate = c.db.prepare(
        `INSERT INTO carrier_customer_rates
           (carrier_id, customer_id, spec, spec_key, is_default, transport_fee, gate_fee, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(carrier_id, customer_id, spec_key) DO NOTHING`,
      );
      const refreshedCustomers = new Set();
      for (const rate of preview.rates) {
        if (rate.status !== 'ready') continue;
        let carrierId = carrierIds.get(rate.carrierKey);
        if (!carrierId) {
          const carrier = ensureCustomerCarrier(c.db, rate.customerId, rate.carrierName, at);
          carrierId = carrier?.id;
          if (!carrierId) continue;
          carrierIds.set(rate.carrierKey, carrierId);
        }
        assign.run(carrierId, rate.customerId, at);
        upsertRate.run(
          carrierId, rate.customerId, rate.spec, rate.specKey, Number(rate.isDefault),
          rate.transportFee, rate.gateFee, rate.note, at, at,
        );
        refreshedCustomers.add(rate.customerId);
      }
      for (const customerId of refreshedCustomers) refreshCustomerCarrier(c.db, customerId, at);
      const summary = {
        carriersCreated: preview.carrierSummary.ready,
        carriersUpdated: 0,
        ratesCreated: preview.rateSummary.ready,
        ratesUpdated: 0,
        skipped: preview.carrierSummary.skipped + preview.rateSummary.skipped,
      };
      writeAudit(c.db, c.user, 'carrier.excel.import', 'carrier', null, summary);
      return summary;
    });
  });

  router.get('/api/carriers', async (c) => {
    c.requirePage(PAGE);
    const rows = c.db.prepare('SELECT * FROM carriers ORDER BY is_active DESC, name COLLATE NOCASE').all();
    const ids = carrierIds(c.db);
    const totalCustomers = Number(c.db.prepare('SELECT COUNT(*) AS count FROM customers').get().count);
    const linkedCustomers = Number(c.db.prepare('SELECT COUNT(DISTINCT customer_id) AS count FROM carrier_customers').get().count);
    return {
      items: rows.map((row) => toApi(row, ids.get(row.id) ?? [])),
      activeCount: rows.filter((row) => row.is_active).length,
      linkCount: Number(c.db.prepare('SELECT COUNT(*) AS count FROM carrier_customers').get().count),
      unassignedCustomerCount: Math.max(0, totalCustomers - linkedCustomers),
    };
  });

  router.get('/api/carriers/:id/customers', async (c) => {
    c.requirePage(PAGE);
    const carrier = load(c.db, Number(c.params.id));
    const rows = c.db.prepare(
      `SELECT customers.*
       FROM carrier_customers
       INNER JOIN customers ON customers.id = carrier_customers.customer_id
       WHERE carrier_customers.carrier_id = ?
       ORDER BY customers.customer_name COLLATE NOCASE, customers.id`,
    ).all(carrier.id);
    return { items: rows.map(toCustomerApi) };
  });

  router.get('/api/carriers/:id/customers/:customerId/rates', async (c) => {
    c.requirePage(PAGE);
    const carrier = load(c.db, Number(c.params.id));
    const customerId = Number(c.params.customerId);
    ensureAssignment(c.db, carrier.id, customerId);
    const rows = c.db.prepare(
      `SELECT * FROM carrier_customer_rates
       WHERE carrier_id = ? AND customer_id = ?
       ORDER BY is_default ASC, spec COLLATE NOCASE, id`,
    ).all(carrier.id, customerId);
    return { items: rows.map(toRateApi) };
  });

  router.post('/api/carriers/:id/customers/:customerId/rates', async (c) => {
    c.requirePage(PAGE);
    const carrier = load(c.db, Number(c.params.id));
    const customerId = Number(c.params.customerId);
    ensureAssignment(c.db, carrier.id, customerId);
    const input = readRateInput(c.body);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      try {
        const result = c.db.prepare(
          `INSERT INTO carrier_customer_rates
             (carrier_id, customer_id, spec, spec_key, is_default, transport_fee, gate_fee, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(carrier.id, customerId, input.spec, input.specKey, Number(input.isDefault), input.transportFee, input.gateFee, input.note, at, at);
        const rate = c.db.prepare('SELECT * FROM carrier_customer_rates WHERE id = ?').get(Number(result.lastInsertRowid));
        writeAudit(c.db, c.user, 'carrier.rate.create', 'carrier_customer_rate', rate.id, { carrierId: carrier.id, customerId, rate: toRateApi(rate) });
        return toRateApi(rate);
      } catch (error) {
        if (isUniqueConstraint(error)) {
          throw badRequest('Quy cách này đã có mức cước cho nhà xe và khách hàng đã chọn.');
        }
        throw error;
      }
    });
  });

  router.patch('/api/carriers/:id/customers/:customerId/rates/:rateId', async (c) => {
    c.requirePage(PAGE);
    const carrier = load(c.db, Number(c.params.id));
    const customerId = Number(c.params.customerId);
    ensureAssignment(c.db, carrier.id, customerId);
    const before = c.db.prepare(
      'SELECT * FROM carrier_customer_rates WHERE id = ? AND carrier_id = ? AND customer_id = ?',
    ).get(Number(c.params.rateId), carrier.id, customerId);
    if (!before) throw notFound('Không tìm thấy mức cước.');
    const input = readRateInput(c.body);
    return transaction(c.db, () => {
      try {
        c.db.prepare(
          `UPDATE carrier_customer_rates SET spec = ?, spec_key = ?, is_default = ?, transport_fee = ?, gate_fee = ?, note = ?, updated_at = ? WHERE id = ?`,
        ).run(input.spec, input.specKey, Number(input.isDefault), input.transportFee, input.gateFee, input.note, new Date().toISOString(), before.id);
        const after = c.db.prepare('SELECT * FROM carrier_customer_rates WHERE id = ?').get(before.id);
        writeAudit(c.db, c.user, 'carrier.rate.update', 'carrier_customer_rate', before.id, { before: toRateApi(before), after: toRateApi(after) });
        return toRateApi(after);
      } catch (error) {
        if (isUniqueConstraint(error)) {
          throw badRequest('Quy cách này đã có mức cước cho nhà xe và khách hàng đã chọn.');
        }
        throw error;
      }
    });
  });

  router.delete('/api/carriers/:id/customers/:customerId/rates/:rateId', async (c) => {
    c.requirePage(PAGE);
    const carrier = load(c.db, Number(c.params.id));
    const customerId = Number(c.params.customerId);
    ensureAssignment(c.db, carrier.id, customerId);
    const before = c.db.prepare(
      'SELECT * FROM carrier_customer_rates WHERE id = ? AND carrier_id = ? AND customer_id = ?',
    ).get(Number(c.params.rateId), carrier.id, customerId);
    if (!before) throw notFound('Không tìm thấy mức cước.');
    c.db.prepare('DELETE FROM carrier_customer_rates WHERE id = ?').run(before.id);
    writeAudit(c.db, c.user, 'carrier.rate.delete', 'carrier_customer_rate', before.id, { carrierId: carrier.id, customerId, rate: toRateApi(before) });
    return { ok: true };
  });

  router.post('/api/carriers', async (c) => {
    c.requirePage(PAGE);
    const input = readInput(c.body);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      ensureAvailable(c.db, input.key);
      const result = c.db.prepare(`INSERT INTO carriers (name, contact, phone, address, schedule, note, is_active, carrier_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.name, input.contact, input.phone, input.address, input.schedule, input.note, Number(input.isActive), input.key, at, at);
      const row = load(c.db, Number(result.lastInsertRowid));
      writeAudit(c.db, c.user, 'carrier.create', 'carrier', row.id, toApi(row));
      return toApi(row);
    });
  });

  router.patch('/api/carriers/:id', async (c) => {
    c.requirePage(PAGE);
    const before = load(c.db, Number(c.params.id));
    const input = readInput(c.body);
    return transaction(c.db, () => {
      ensureAvailable(c.db, input.key, before.id);
      const at = new Date().toISOString();
      c.db.prepare('UPDATE carriers SET name = ?, contact = ?, phone = ?, address = ?, schedule = ?, note = ?, is_active = ?, carrier_key = ?, updated_at = ? WHERE id = ?')
        .run(input.name, input.contact, input.phone, input.address, input.schedule, input.note, Number(input.isActive), input.key, at, before.id);
      const customerIds = c.db.prepare(
        'SELECT customer_id FROM carrier_customers WHERE carrier_id = ?',
      ).all(before.id).map((row) => row.customer_id);
      for (const customerId of customerIds) refreshCustomerCarrier(c.db, customerId, at);
      const after = load(c.db, before.id);
      writeAudit(c.db, c.user, 'carrier.update', 'carrier', before.id, { before: toApi(before), after: toApi(after) });
      return toApi(after);
    });
  });

  router.delete('/api/carriers/:id', async (c) => {
    c.requirePage(PAGE);
    const row = load(c.db, Number(c.params.id));
    return transaction(c.db, () => {
      const customerIds = c.db.prepare(
        'SELECT customer_id FROM carrier_customers WHERE carrier_id = ?',
      ).all(row.id).map((item) => item.customer_id);
      c.db.prepare('DELETE FROM carriers WHERE id = ?').run(row.id);
      const at = new Date().toISOString();
      for (const customerId of customerIds) refreshCustomerCarrier(c.db, customerId, at);
      writeAudit(c.db, c.user, 'carrier.delete', 'carrier', row.id, toApi(row));
      return { ok: true };
    });
  });

  router.patch('/api/carriers/:id/customers', async (c) => {
    c.requirePage(PAGE);
    const carrier = load(c.db, Number(c.params.id));
    const customerIds = [...new Set(Array.isArray(c.body.customerIds) ? c.body.customerIds.map(Number).filter(Number.isInteger) : [])];
    if (!customerIds.length) throw badRequest('Hãy chọn ít nhất một khách hàng.');
    return transaction(c.db, () => {
      const placeholders = customerIds.map(() => '?').join(', ');
      const existing = c.db.prepare(`SELECT id FROM customers WHERE id IN (${placeholders})`).all(...customerIds);
      if (existing.length !== customerIds.length) throw badRequest('Có khách hàng không còn tồn tại.');
      const insert = c.db.prepare('INSERT OR IGNORE INTO carrier_customers (carrier_id, customer_id, assigned_at) VALUES (?, ?, ?)');
      const at = new Date().toISOString();
      for (const customerId of customerIds) insert.run(carrier.id, customerId, at);
      for (const customerId of customerIds) refreshCustomerCarrier(c.db, customerId, at);
      writeAudit(c.db, c.user, 'carrier.assign_customers', 'carrier', carrier.id, { customerIds });
      return { ok: true };
    });
  });

  router.delete('/api/carriers/:id/customers/:customerId', async (c) => {
    c.requirePage(PAGE);
    const carrier = load(c.db, Number(c.params.id));
    const result = c.db.prepare('DELETE FROM carrier_customers WHERE carrier_id = ? AND customer_id = ?').run(carrier.id, Number(c.params.customerId));
    if (result.changes === 0) throw notFound('Khách hàng này chưa được gán cho nhà xe.');
    refreshCustomerCarrier(c.db, Number(c.params.customerId), new Date().toISOString());
    writeAudit(c.db, c.user, 'carrier.unassign_customer', 'carrier', carrier.id, { customerId: Number(c.params.customerId) });
    return { ok: true };
  });
}

module.exports = { register };
