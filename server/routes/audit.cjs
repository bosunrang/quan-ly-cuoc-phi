'use strict';

const PAGE = 'audit';
const MAX_LIMIT = 500;
const { badRequest, forbidden } = require('../http.cjs');
const { writeAudit } = require('../audit.cjs');
const SEARCH_ALIASES = {
  'bao cao': ['report.'],
  'excel': ['report.'],
  'xang': ['fuel.'],
  'tinh xang': ['fuel.'],
  'phieu': ['entry.'],
  'chi phi': ['entry.', 'fuel.'],
  'gui hang': ['entry.'],
  'nhap chi phi': ['entry.create'],
  'cuoc': ['entry.', 'carrier.rate.'],
  'misa': ['misa.'],
  'nhan vien': ['employee.'],
  'khach hang': ['customer.'],
  'nha xe': ['carrier.'],
  'nguoi dung': ['user.', 'login', 'logout', 'password.'],
  'tai khoan': ['user.', 'login', 'logout', 'password.'],
  'cai dat': ['settings.'],
};
const normalize = (value) => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .trim();

function filters(query) {
  const clauses = [];
  const values = [];
  const q = String(query.q || '').trim().slice(0, 120);
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const normalizedQuery = normalize(q);
    const normalizedPattern = `%${normalizedQuery.replace(/[%_\\]/g, '\\$&')}%`;
    const aliases = Object.entries(SEARCH_ALIASES)
      .filter(([keyword]) => normalizedQuery.includes(keyword))
      .flatMap(([, prefixes]) => prefixes);
    const actionAliases = aliases.map(() => 'action LIKE ?');
    clauses.push(`(audit_log.username LIKE ? ESCAPE '\\' OR vn_normalize(COALESCE(users.full_name, '')) LIKE ? ESCAPE '\\' OR audit_log.action LIKE ? ESCAPE '\\' OR audit_log.entity LIKE ? ESCAPE '\\' OR audit_log.entity_id LIKE ? ESCAPE '\\'${actionAliases.length ? ` OR ${actionAliases.join(' OR ')}` : ''})`);
    values.push(pattern, normalizedPattern, pattern, pattern, pattern, ...aliases.map((prefix) => `${prefix}%`));
  }
  clauses.push("action <> 'login.dev'");
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function parseDetail(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { message: String(value) };
  }
}

function cleanupBefore(value) {
  const date = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest('Vui lòng chọn ngày dọn nhật ký hợp lệ.');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest('Vui lòng chọn ngày dọn nhật ký hợp lệ.');
  }
  return { date, cutoff: parsed.toISOString() };
}

function register(router) {
  router.get('/api/audit', async (c) => {
    c.requirePage(PAGE);
    const limit = Math.max(1, Math.min(Number(c.query.limit) || 50, MAX_LIMIT));
    const offset = Math.max(0, Number(c.query.offset) || 0);
    const filter = filters(c.query);
    const rows = c.db
      .prepare(
      `SELECT audit_log.id, audit_log.at, audit_log.user_id, audit_log.username,
              audit_log.action, audit_log.entity, audit_log.entity_id, audit_log.detail
           FROM audit_log
           LEFT JOIN users ON users.id = audit_log.user_id
           ${filter.where} ORDER BY audit_log.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...filter.values, limit, offset);
    const total = c.db.prepare(
      `SELECT COUNT(*) AS total FROM audit_log
       LEFT JOIN users ON users.id = audit_log.user_id ${filter.where}`,
    ).get(...filter.values).total;
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        at: row.at,
        userId: row.user_id,
        username: row.username,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        detail: parseDetail(row.detail),
      })),
    };
  });

  router.post('/api/audit/cleanup', async (c) => {
    c.requirePage(PAGE);
    if (!c.user.is_admin) {
      throw forbidden('Chỉ quản trị viên được dọn nhật ký hoạt động.');
    }
    const { date, cutoff } = cleanupBefore(c.body.beforeDate);
    const deleted = c.db.prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff).changes;
    writeAudit(c.db, c.user, 'audit.cleanup', 'audit_log', null, {
      beforeDate: date,
      deleted,
    });
    return { deleted };
  });
}

module.exports = { register };
