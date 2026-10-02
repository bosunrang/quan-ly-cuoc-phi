'use strict';

const { canSeeEveryone } = require('../permissions.cjs');
const { badRequest, isIsoDate, localIsoDate } = require('../http.cjs');

const PAGE = 'dashboard';
function readPeriod(query) {
  const today = localIsoDate();
  const defaultFrom = `${today.slice(0, 7)}-01`;
  const from = query.from ? String(query.from) : defaultFrom;
  const to = query.to ? String(query.to) : today;
  if (!isIsoDate(from) || !isIsoDate(to)) throw badRequest('Khoảng ngày không hợp lệ.');
  if (from > to) throw badRequest('Khoảng ngày không hợp lệ.');
  return { from, to };
}

function employeeFilter(db, user, query) {
  if (!canSeeEveryone(user)) return { employeeId: null, ownUserId: user.id };
  if (!query.employeeId) return { employeeId: null, ownUserId: null };
  const employeeId = Number(query.employeeId);
  if (!Number.isInteger(employeeId) || employeeId < 1) {
    throw badRequest('Nhân viên không hợp lệ.');
  }
  if (!db.prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1').get(employeeId)) {
    throw badRequest('Nhân viên không hoạt động hoặc không tồn tại.');
  }
  return { employeeId, ownUserId: null };
}

function whereFor(alias, period, filter) {
  const where = [`${alias}.entry_date >= ?`, `${alias}.entry_date <= ?`];
  const params = [period.from, period.to];
  if (filter.ownUserId) {
    where.push(`${alias}.created_by = ?`);
    params.push(filter.ownUserId);
  } else if (filter.employeeId) {
    where.push(`${alias}.employee_id = ?`);
    params.push(filter.employeeId);
  }
  return { sql: where.join(' AND '), params };
}

function register(router) {
  router.get('/api/dashboard', async (c) => {
    c.requirePage(PAGE);
    const period = readPeriod(c.query);
    const filter = employeeFilter(c.db, c.user, c.query);
    const entryWhere = whereFor('e', period, filter);
    const fuelWhere = whereFor('f', period, filter);
    const entrySummary = c.db.prepare(
      `SELECT COUNT(*) AS entries, COALESCE(SUM(e.transport_fee), 0) AS transport,
       COALESCE(SUM(e.gate_fee), 0) AS gate, COALESCE(SUM(e.other_fee), 0) AS other,
       COUNT(DISTINCT e.customer) AS customers
       FROM entries e WHERE ${entryWhere.sql}`,
    ).get(...entryWhere.params);
    const fuelSummary = c.db.prepare(
      `SELECT COALESCE(SUM(f.total_fee), 0) AS fuel FROM fuel_records f WHERE ${fuelWhere.sql}`,
    ).get(...fuelWhere.params);
    const variance = c.db.prepare(
      `SELECT COUNT(*) AS entries, COALESCE(SUM(ABS(e.transport_fee - r.transport_fee)), 0) AS amount
       FROM entries e
       INNER JOIN customers cu ON cu.customer_key = vn_normalize(e.customer)
       INNER JOIN carriers ca ON ca.carrier_key = vn_normalize(e.carrier)
       INNER JOIN carrier_customer_rates r ON r.id = (
         SELECT id FROM carrier_customer_rates
          WHERE customer_id = cu.id AND carrier_id = ca.id
            AND (spec_key = vn_normalize(e.spec) OR is_default = 1)
          ORDER BY is_default ASC, id LIMIT 1
       )
       WHERE ${entryWhere.sql} AND e.transport_fee <> r.transport_fee`,
    ).get(...entryWhere.params);
    const monthlyVariance = c.db.prepare(
      `SELECT substr(e.entry_date, 1, 7) AS month,
         COALESCE(SUM(r.transport_fee), 0) AS standard_fee,
         COALESCE(SUM(e.transport_fee), 0) AS actual_fee,
         COALESCE(SUM(e.transport_fee - r.transport_fee), 0) AS difference,
         COUNT(*) AS entries
       FROM entries e
       INNER JOIN customers cu ON cu.customer_key = vn_normalize(e.customer)
       INNER JOIN carriers ca ON ca.carrier_key = vn_normalize(e.carrier)
       INNER JOIN carrier_customer_rates r ON r.id = (
         SELECT id FROM carrier_customer_rates
          WHERE customer_id = cu.id AND carrier_id = ca.id
            AND (spec_key = vn_normalize(e.spec) OR is_default = 1)
          ORDER BY is_default ASC, id LIMIT 1
       )
       WHERE ${entryWhere.sql} AND e.transport_fee <> r.transport_fee
       GROUP BY substr(e.entry_date, 1, 7)
       ORDER BY month ASC`,
    ).all(...entryWhere.params).map((row) => ({
      month: row.month,
      standardFee: Number(row.standard_fee),
      actualFee: Number(row.actual_fee),
      difference: Number(row.difference),
      entries: Number(row.entries),
    }));
    const employees = canSeeEveryone(c.user)
      ? c.db.prepare('SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all()
      : [];
    const daily = new Map();
    for (const row of c.db.prepare(
      `SELECT e.entry_date AS day, COALESCE(SUM(e.transport_fee), 0) AS transport,
       COALESCE(SUM(e.gate_fee), 0) AS gate, COALESCE(SUM(e.other_fee), 0) AS other
       FROM entries e WHERE ${entryWhere.sql} GROUP BY e.entry_date`,
    ).all(...entryWhere.params)) {
      daily.set(row.day, { day: row.day, transport: Number(row.transport), gate: Number(row.gate), other: Number(row.other), fuel: 0 });
    }
    for (const row of c.db.prepare(
      `SELECT f.entry_date AS day, COALESCE(SUM(f.total_fee), 0) AS fuel
       FROM fuel_records f WHERE ${fuelWhere.sql} GROUP BY f.entry_date`,
    ).all(...fuelWhere.params)) {
      const current = daily.get(row.day) ?? { day: row.day, transport: 0, gate: 0, other: 0, fuel: 0 };
      current.fuel = Number(row.fuel);
      daily.set(row.day, current);
    }
    const transport = Number(entrySummary.transport);
    const gate = Number(entrySummary.gate);
    const other = Number(entrySummary.other);
    const fuel = Number(fuelSummary.fuel);
    return {
      scope: canSeeEveryone(c.user) ? 'all' : 'own', period,
      employees: employees.map((row) => ({ id: row.id, name: row.full_name })),
      summary: { entries: Number(entrySummary.entries), customers: Number(entrySummary.customers), transport, gate, other, fuel, total: transport + gate + other + fuel, varianceEntries: Number(variance.entries), varianceAmount: Number(variance.amount) },
      monthlyVariance,
      daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)).map((row) => ({ ...row, total: row.transport + row.gate + row.other + row.fuel })),
    };
  });
}

module.exports = { register };
