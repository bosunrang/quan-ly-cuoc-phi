'use strict';

const { normalizeSearchText } = require('./db.cjs');

function namesFromText(value) {
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

function ensureCarrier(db, name, at) {
  const key = normalizeSearchText(name);
  let carrier = db.prepare('SELECT id, name FROM carriers WHERE carrier_key = ?').get(key);
  if (!carrier) {
    const result = db.prepare(
      `INSERT INTO carriers
         (name, contact, phone, address, is_active, carrier_key, schedule, note, created_at, updated_at)
       VALUES (?, '', '', '', 1, ?, '', '', ?, ?)`,
    ).run(name, key, at, at);
    carrier = { id: Number(result.lastInsertRowid), name };
  }
  return carrier;
}

function linkedCarrierNames(db, customerId) {
  return db.prepare(
    `SELECT carriers.name
       FROM carrier_customers
       INNER JOIN carriers ON carriers.id = carrier_customers.carrier_id
      WHERE carrier_customers.customer_id = ?
      ORDER BY carriers.name COLLATE NOCASE, carriers.id`,
  ).all(customerId).map((row) => row.name);
}

function ensureCustomerCarrier(db, customerId, name, at) {
  if (!String(name ?? '').trim()) return null;
  const carrier = ensureCarrier(db, String(name).trim(), at);
  db.prepare(
    `INSERT INTO carrier_customers (carrier_id, customer_id, assigned_at)
     VALUES (?, ?, ?) ON CONFLICT(carrier_id, customer_id) DO NOTHING`,
  ).run(carrier.id, customerId, at);
  return carrier;
}

/** Thay toàn bộ danh sách nhà xe của một khách hàng theo phần chỉnh sửa danh mục. */
function replaceCustomerCarriers(db, customerId, value, at) {
  const carriers = namesFromText(value).map((name) => ensureCarrier(db, name, at));
  const ids = carriers.map((carrier) => carrier.id);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(
      `DELETE FROM carrier_customers
       WHERE customer_id = ? AND carrier_id NOT IN (${placeholders})`,
    ).run(customerId, ...ids);
  } else {
    db.prepare('DELETE FROM carrier_customers WHERE customer_id = ?').run(customerId);
  }
  const insert = db.prepare(
    `INSERT INTO carrier_customers (carrier_id, customer_id, assigned_at)
     VALUES (?, ?, ?) ON CONFLICT(carrier_id, customer_id) DO NOTHING`,
  );
  for (const carrier of carriers) insert.run(carrier.id, customerId, at);
  return linkedCarrierNames(db, customerId);
}

/** Sao chép danh sách liên kết chuẩn về trường hiển thị và chỉ mục tìm kiếm của khách hàng. */
function refreshCustomerCarrier(db, customerId, at) {
  const customer = db.prepare(
    'SELECT customer_name, recipient, address FROM customers WHERE id = ?',
  ).get(customerId);
  if (!customer) return [];
  const names = linkedCarrierNames(db, customerId);
  const carrier = names.join(', ');
  db.prepare(
    `UPDATE customers SET carrier = ?, search_text = ?, updated_at = ? WHERE id = ?`,
  ).run(
    carrier,
    normalizeSearchText(
      `${customer.customer_name} ${carrier} ${customer.recipient} ${customer.address}`,
    ),
    at,
    customerId,
  );
  return names;
}

module.exports = {
  ensureCustomerCarrier,
  refreshCustomerCarrier,
  replaceCustomerCarriers,
};
