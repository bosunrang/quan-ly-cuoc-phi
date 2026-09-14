'use strict';

const { transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest, notFound } = require('../http.cjs');
const { calculateFuelTotal, toFuelPrice } = require('./calculation.cjs');
const { saveRouteLegs } = require('./routes.cjs');

function activeEmployee(db, user, isAdmin, requestedEmployeeId) {
  const employee = isAdmin
    ? db
      .prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1')
      .get(Number(requestedEmployeeId))
    : db
      .prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1')
      .get(user.id);
  if (!employee) throw badRequest('Vui lòng chọn nhân viên đang hoạt động.');
  return employee;
}

function currentEmployee(db, user, isAdmin) {
  if (isAdmin) return null;
  return db
    .prepare('SELECT id, full_name FROM employees WHERE user_id = ? AND is_active = 1')
    .get(user.id);
}

function listFuelData(db, user, isAdmin, query, fuelTypes) {
  const employee = currentEmployee(db, user, isAdmin);
  const employees = isAdmin
    ? db
      .prepare('SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE')
      .all()
    : employee
      ? [employee]
      : [];
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const requestedEmployeeId = Number(query.employeeId) || null;
  const conditions = [];
  const params = [];

  if (!isAdmin) {
    // Nhân viên xem cả kỳ do Admin lập hộ, nhưng không tự sửa/xóa được kỳ đó.
    conditions.push('f.employee_id = ?');
    params.push(employee?.id ?? -1);
  }
  if (requestedEmployeeId) {
    conditions.push('f.employee_id = ?');
    params.push(requestedEmployeeId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const recordsTotal = Number(
    db
      .prepare(`SELECT COUNT(*) AS count FROM fuel_records f ${where}`)
      .get(...params).count,
  );
  const records = db
    .prepare(
      `SELECT f.*, e.full_name AS employee_name
       FROM fuel_records f
       LEFT JOIN employees e ON e.id = f.employee_id
       ${where}
       ORDER BY f.entry_date DESC, f.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const legsForRecord = db.prepare(
    `SELECT sequence_no, from_name, to_name, distance_km
     FROM fuel_record_legs WHERE fuel_record_id = ? ORDER BY sequence_no`,
  );
  const prices = db
    .prepare('SELECT * FROM fuel_prices ORDER BY effective_date DESC, fuel_type, region')
    .all();
  const distances = db
    .prepare('SELECT id, from_name, to_name, distance_km FROM route_distances ORDER BY updated_at DESC')
    .all();
  const locations = [
    ...db
      .prepare("SELECT id, customer_name AS name, address, 'customer' AS type FROM customers WHERE trim(address) <> ''")
      .all(),
    ...db
      .prepare("SELECT id, name, address, 'carrier' AS type FROM carriers WHERE is_active = 1 AND trim(address) <> ''")
      .all(),
    ...db
      .prepare("SELECT id, full_name AS name, address, 'employee' AS type FROM employees WHERE is_active = 1 AND trim(address) <> ''")
      .all(),
  ].sort((left, right) => left.name.localeCompare(right.name, 'vi'));

  return {
    prices: prices.map(toFuelPrice),
    employees: employees.map((item) => ({ id: item.id, name: item.full_name })),
    currentEmployee: employee ? { id: employee.id, name: employee.full_name } : null,
    locations,
    distances: distances.map((item) => ({
      id: item.id,
      from: item.from_name,
      to: item.to_name,
      km: item.distance_km,
    })),
    records: records.map((item) => ({
      id: item.id,
      entryDate: item.entry_date,
      periodFrom: item.period_from || item.entry_date,
      periodTo: item.period_to || item.entry_date,
      employeeId: item.employee_id,
      employeeName: item.employee_name,
      distanceKm: item.distance_km,
      consumptionLiters: item.consumption_liters,
      consumptionBaseKm: item.consumption_base_km,
      fuelType: item.fuel_type,
      region: item.region,
      fuelPrice: item.fuel_price,
      totalFee: item.total_fee,
      status: item.status,
      voidReason: item.void_reason,
      finalizedAt: item.finalized_at,
      legs: legsForRecord.all(item.id).map((leg) => ({
        from: leg.from_name,
        to: leg.to_name,
        km: leg.distance_km,
      })),
      canEdit: item.status === 'active' && !item.finalized_at && (isAdmin || item.created_by === user.id),
      canDelete: item.status === 'active' && !item.finalized_at && (isAdmin || item.created_by === user.id),
      canVoid: isAdmin && item.status === 'active' && Boolean(item.finalized_at),
    })),
    recordsTotal,
    fuelTypes,
    isAdmin,
  };
}

function saveFuelRecord(db, user, input, employeeId, id = null) {
  const totalFee = calculateFuelTotal(input);
  const at = new Date().toISOString();
  return transaction(db, () => {
    let recordId = id;
    if (recordId === null) {
      const result = db
        .prepare(
          `INSERT INTO fuel_records
           (entry_date, period_from, period_to, employee_id, distance_km,
            consumption_liters, consumption_base_km, fuel_type, region,
            fuel_price, total_fee, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.periodTo,
          input.periodFrom,
          input.periodTo,
          employeeId,
          input.distanceKm,
          input.consumptionLiters,
          input.consumptionBaseKm,
          input.fuelType,
          input.region,
          input.fuelPrice,
          totalFee,
          user.id,
          at,
          at,
        );
      recordId = Number(result.lastInsertRowid);
    } else {
      db
        .prepare(
          `UPDATE fuel_records SET
           entry_date = ?, period_from = ?, period_to = ?, employee_id = ?,
           distance_km = ?, consumption_liters = ?, consumption_base_km = ?,
           fuel_type = ?, region = ?, fuel_price = ?, total_fee = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.periodTo,
          input.periodFrom,
          input.periodTo,
          employeeId,
          input.distanceKm,
          input.consumptionLiters,
          input.consumptionBaseKm,
          input.fuelType,
          input.region,
          input.fuelPrice,
          totalFee,
          at,
          recordId,
        );
      db.prepare('DELETE FROM fuel_record_legs WHERE fuel_record_id = ?').run(recordId);
    }
    saveRouteLegs(db, recordId, input.legs, at);
    writeAudit(
      db,
      user,
      id === null ? 'fuel.record.create' : 'fuel.record.update',
      'fuel_record',
      recordId,
      { ...input, employeeId, totalFee },
    );
    return { id: recordId, totalFee };
  });
}

function editableRecord(db, id, user, isAdmin) {
  const record = db.prepare('SELECT * FROM fuel_records WHERE id = ?').get(id);
  if (!record) throw notFound('Không tìm thấy lần tính xăng.');
  if (record.status !== 'active' || record.finalized_at) {
    throw badRequest('Lần tính đã chốt; chỉ quản trị viên có thể hủy kèm lý do.');
  }
  if (!isAdmin && record.created_by !== user.id) {
    throw badRequest('Bạn chỉ được sửa lần tính do mình tạo.');
  }
  return record;
}

function deleteFuelRecord(db, id, user, isAdmin, reason) {
  const record = db.prepare('SELECT * FROM fuel_records WHERE id = ?').get(id);
  if (!record) throw notFound('Không tìm thấy lần tính xăng.');
  if (record.status !== 'active') throw badRequest('Lần tính này đã được hủy.');

  if (record.finalized_at) {
    if (!isAdmin) throw badRequest('Lần tính đã chốt; vui lòng liên hệ quản trị viên để hủy.');
    if (!reason) throw badRequest('Vui lòng nhập lý do hủy lần tính đã chốt.');
    const at = new Date().toISOString();
    db
      .prepare(
        "UPDATE fuel_records SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?, updated_at = ? WHERE id = ?",
      )
      .run(at, user.id, reason, at, id);
    writeAudit(db, user, 'fuel.record.void', 'fuel_record', id, { reason });
    return { ok: true, voided: true };
  }
  if (!isAdmin && record.created_by !== user.id) {
    throw badRequest('Bạn chỉ được xóa lần tính do mình tạo.');
  }
  transaction(db, () => {
    db.prepare('DELETE FROM fuel_records WHERE id = ?').run(id);
    writeAudit(db, user, 'fuel.record.delete', 'fuel_record', id, {
      periodFrom: record.period_from,
      periodTo: record.period_to,
      totalFee: record.total_fee,
    });
  });
  return { ok: true, voided: false };
}

module.exports = {
  activeEmployee,
  listFuelData,
  saveFuelRecord,
  editableRecord,
  deleteFuelRecord,
};
