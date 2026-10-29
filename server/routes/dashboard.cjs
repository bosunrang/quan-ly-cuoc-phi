'use strict';

const { canSeeEveryone } = require('../permissions.cjs');
const { badRequest, isIsoDate, localIsoDate } = require('../http.cjs');

const PAGE = 'dashboard';
// Chênh lệch so với giá chuẩn đã chốt trên phiếu, cùng nguồn với báo cáo
// chênh lệch nhà xe: sửa bảng cước không làm đổi số liệu các tháng đã qua.
const VARIANCE_WHERE =
  'e.standard_transport_fee IS NOT NULL AND e.transport_fee <> e.standard_transport_fee';

/** Chỉ nhận khoản phát sinh hợp lệ đã lưu tại thẻ tính giá xăng. */
function fuelExtraTotal(value) {
  try {
    const items = JSON.parse(value || '[]');
    if (!Array.isArray(items)) return 0;
    return items.reduce((sum, item) => {
      const amount = Number(item?.amount);
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
    }, 0);
  } catch {
    return 0;
  }
}

/** total_fee gồm cả khoản phát sinh; tách ra để Tổng quan không cộng hai lần. */
function fuelCosts(record) {
  const total = Number(record.total_fee) || 0;
  const other = fuelExtraTotal(record.extra_costs);
  return { fuel: Math.max(0, total - other), other };
}

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
  // Nhân viên xem số liệu của hồ sơ nhân viên liên kết với tài khoản, kể cả
  // phiếu Admin nhập hộ — cùng phạm vi với Danh sách phiếu và Báo cáo.
  if (!canSeeEveryone(user)) {
    const employee = db
      .prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1')
      .get(user.id);
    return { employeeId: Number(employee?.id ?? -1), ownUserId: null };
  }
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
    const entrySummary = c.db
      .prepare(
        `SELECT COUNT(*) AS entries, COALESCE(SUM(e.transport_fee), 0) AS transport,
       COALESCE(SUM(e.gate_fee), 0) AS gate,
       COUNT(DISTINCT e.customer) AS customers
       FROM entries e WHERE ${entryWhere.sql}`,
      )
      .get(...entryWhere.params);
    const fuelRecords = c.db
      .prepare(
        `SELECT f.entry_date AS day, f.total_fee, f.extra_costs
         FROM fuel_records f WHERE ${fuelWhere.sql}`,
      )
      .all(...fuelWhere.params);
    const variance = c.db
      .prepare(
        `SELECT COUNT(*) AS entries,
         COALESCE(SUM(ABS(e.transport_fee - e.standard_transport_fee)), 0) AS amount
       FROM entries e
       WHERE ${entryWhere.sql} AND ${VARIANCE_WHERE}`,
      )
      .get(...entryWhere.params);
    const monthlyVariance = c.db
      .prepare(
        `SELECT substr(e.entry_date, 1, 7) AS month,
         COALESCE(SUM(e.standard_transport_fee), 0) AS standard_fee,
         COALESCE(SUM(e.transport_fee), 0) AS actual_fee,
         COALESCE(SUM(e.transport_fee - e.standard_transport_fee), 0) AS difference,
         COUNT(*) AS entries
       FROM entries e
       WHERE ${entryWhere.sql} AND ${VARIANCE_WHERE}
       GROUP BY substr(e.entry_date, 1, 7)
       ORDER BY month ASC`,
      )
      .all(...entryWhere.params)
      .map((row) => ({
        month: row.month,
        standardFee: Number(row.standard_fee),
        actualFee: Number(row.actual_fee),
        difference: Number(row.difference),
        entries: Number(row.entries),
      }));
    const employees = canSeeEveryone(c.user)
      ? c.db
          .prepare(
            'SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE',
          )
          .all()
      : [];
    const daily = new Map();
    for (const row of c.db
      .prepare(
        `SELECT e.entry_date AS day, COALESCE(SUM(e.transport_fee), 0) AS transport,
       COALESCE(SUM(e.gate_fee), 0) AS gate
       FROM entries e WHERE ${entryWhere.sql} GROUP BY e.entry_date`,
      )
      .all(...entryWhere.params)) {
      daily.set(row.day, {
        day: row.day,
        transport: Number(row.transport),
        gate: Number(row.gate),
        other: 0,
        fuel: 0,
      });
    }
    let fuel = 0;
    let other = 0;
    for (const row of fuelRecords) {
      const current = daily.get(row.day) ?? {
        day: row.day,
        transport: 0,
        gate: 0,
        other: 0,
        fuel: 0,
      };
      const costs = fuelCosts(row);
      current.fuel += costs.fuel;
      current.other += costs.other;
      fuel += costs.fuel;
      other += costs.other;
      daily.set(row.day, current);
    }
    const transport = Number(entrySummary.transport);
    const gate = Number(entrySummary.gate);
    return {
      scope: canSeeEveryone(c.user) ? 'all' : 'own',
      period,
      employees: employees.map((row) => ({ id: row.id, name: row.full_name })),
      summary: {
        entries: Number(entrySummary.entries),
        customers: Number(entrySummary.customers),
        transport,
        gate,
        other,
        fuel,
        total: transport + gate + other + fuel,
        varianceEntries: Number(variance.entries),
        varianceAmount: Number(variance.amount),
      },
      monthlyVariance,
      daily: [...daily.values()]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((row) => ({ ...row, total: row.transport + row.gate + row.other + row.fuel })),
    };
  });
}

module.exports = { register };
