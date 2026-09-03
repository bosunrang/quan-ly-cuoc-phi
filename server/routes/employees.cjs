'use strict';

const { normalizeSearchText, transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest, notFound } = require('../http.cjs');

const PAGE = 'employees';

function text(value, field, { required = false, max = 300 } = {}) {
  const result = String(value ?? '').trim();
  if (required && !result) throw badRequest(`Vui lòng nhập ${field}.`);
  if (result.length > max) throw badRequest(`${field} không được dài quá ${max} ký tự.`);
  return result;
}

function userId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw badRequest('Tài khoản liên kết không hợp lệ.');
  return id;
}

function readInput(body) {
  const fullName = text(body.fullName, 'họ tên', { required: true });
  const address = text(body.address, 'địa chỉ', { max: 500 });
  return {
    fullName,
    address,
    userId: userId(body.userId),
    isActive: body.isActive !== false,
    searchText: normalizeSearchText(`${fullName} ${address}`),
  };
}

function toApi(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    address: row.address,
    userId: row.user_id,
    linkedUsername: row.username ?? '',
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function load(db, id) {
  const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!row) throw notFound('Không tìm thấy nhân viên.');
  return row;
}

function ensureUser(db, id, employeeId = null) {
  if (!id) return;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) throw badRequest('Tài khoản liên kết không còn tồn tại.');
  const linked = employeeId
    ? db.prepare('SELECT id FROM employees WHERE user_id = ? AND id <> ?').get(id, employeeId)
    : db.prepare('SELECT id FROM employees WHERE user_id = ?').get(id);
  if (linked) throw badRequest('Tài khoản này đã được liên kết với nhân viên khác.');
}

function register(router) {
  router.get('/api/employees', async (c) => {
    c.requirePage(PAGE);
    const search = normalizeSearchText(String(c.query.search ?? '').slice(0, 150));
    const rows = c.db.prepare(
      `SELECT employees.*, users.username
       FROM employees
       LEFT JOIN users ON users.id = employees.user_id
       WHERE employees.search_text LIKE ?
       ORDER BY employees.is_active DESC, employees.full_name COLLATE NOCASE, employees.id`,
    ).all(`%${search}%`);
    const summary = c.db.prepare(
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
              SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_user_count,
              SUM(CASE WHEN address <> '' THEN 1 ELSE 0 END) AS address_count
       FROM employees`,
    ).get();
    return {
      items: rows.map(toApi),
      count: Number(summary.count),
      activeCount: Number(summary.active_count ?? 0),
      linkedUserCount: Number(summary.linked_user_count ?? 0),
      addressCount: Number(summary.address_count ?? 0),
    };
  });

  router.post('/api/employees', async (c) => {
    c.requirePage(PAGE);
    const input = readInput(c.body);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      ensureUser(c.db, input.userId);
      const result = c.db.prepare(
        'INSERT INTO employees (full_name, address, user_id, is_active, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(input.fullName, input.address, input.userId, Number(input.isActive), input.searchText, at, at);
      const row = load(c.db, Number(result.lastInsertRowid));
      writeAudit(c.db, c.user, 'employee.create', 'employee', row.id, toApi(row));
      return toApi(row);
    });
  });

  router.patch('/api/employees/:id', async (c) => {
    c.requirePage(PAGE);
    const before = load(c.db, Number(c.params.id));
    const input = readInput(c.body);
    return transaction(c.db, () => {
      ensureUser(c.db, input.userId, before.id);
      c.db.prepare(
        'UPDATE employees SET full_name = ?, address = ?, user_id = ?, is_active = ?, search_text = ?, updated_at = ? WHERE id = ?',
      ).run(input.fullName, input.address, input.userId, Number(input.isActive), input.searchText, new Date().toISOString(), before.id);
      const after = load(c.db, before.id);
      writeAudit(c.db, c.user, 'employee.update', 'employee', before.id, { before: toApi(before), after: toApi(after) });
      return toApi(after);
    });
  });

  router.delete('/api/employees/:id', async (c) => {
    c.requirePage(PAGE);
    const row = load(c.db, Number(c.params.id));
    return transaction(c.db, () => {
      c.db.prepare('DELETE FROM employees WHERE id = ?').run(row.id);
      writeAudit(c.db, c.user, 'employee.delete', 'employee', row.id, toApi(row));
      return { ok: true };
    });
  });
}

module.exports = { register };
