'use strict';

const { transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest, notFound } = require('../http.cjs');
const { calculateFuelTotal, toFuelPrice } = require('./calculation.cjs');
const { saveRouteLegs } = require('./routes.cjs');

function consumptionProfiles(db) {
  const row = db
    .prepare(`
    SELECT motorcycle_consumption_liters, motorcycle_base_km,
      truck_consumption_liters, truck_base_km
    FROM app_settings WHERE id = 1
  `)
    .get();
  return {
    motorcycle: {
      consumptionLiters: Number(row?.motorcycle_consumption_liters) || 1,
      consumptionBaseKm: Number(row?.motorcycle_base_km) || 40,
    },
    truck: {
      consumptionLiters: Number(row?.truck_consumption_liters) || 7.5,
      consumptionBaseKm: Number(row?.truck_base_km) || 100,
    },
  };
}

function activeEmployee(db, user, isAdmin, requestedEmployeeId, currentEmployeeId = null) {
  // Admin sửa kỳ xăng cũ của nhân viên đã nghỉ: giữ nguyên người phụ trách.
  if (isAdmin && currentEmployeeId !== null && Number(requestedEmployeeId) === currentEmployeeId) {
    return { id: currentEmployeeId };
  }
  const employee = isAdmin
    ? db
        .prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1')
        .get(Number(requestedEmployeeId))
    : db.prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1').get(user.id);
  if (!employee) throw badRequest('Vui lòng chọn nhân viên đang hoạt động.');
  return employee;
}

function currentEmployee(db, user, isAdmin) {
  if (isAdmin) return null;
  return db
    .prepare('SELECT id, full_name FROM employees WHERE user_id = ? AND is_active = 1')
    .get(user.id);
}

function extraCosts(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Lịch sử kỳ tính xăng theo trang. Tách riêng khỏi danh mục để chuyển trang
 * lịch sử không phải tải lại toàn bộ địa điểm, giá xăng và quãng đường.
 */
function fuelHistory(db, user, isAdmin, query) {
  const employee = currentEmployee(db, user, isAdmin);
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
    db.prepare(`SELECT COUNT(*) AS count FROM fuel_records f ${where}`).get(...params).count,
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
  const recordIds = records.map((item) => item.id);
  const legsByRecord = new Map();
  if (recordIds.length) {
    const placeholders = recordIds.map(() => '?').join(', ');
    for (const leg of db
      .prepare(
        `SELECT fuel_record_id, sequence_no, from_name, to_name, distance_km
       FROM fuel_record_legs
       WHERE fuel_record_id IN (${placeholders})
       ORDER BY fuel_record_id, sequence_no`,
      )
      .all(...recordIds)) {
      const legs = legsByRecord.get(leg.fuel_record_id) ?? [];
      legs.push({ from: leg.from_name, to: leg.to_name, km: leg.distance_km });
      legsByRecord.set(leg.fuel_record_id, legs);
    }
  }
  return {
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
      vehicleType: item.vehicle_type,
      fuelType: item.fuel_type,
      region: item.region,
      fuelPrice: item.fuel_price,
      totalFee: item.total_fee,
      extraCosts: extraCosts(item.extra_costs),
      status: item.status,
      voidReason: item.void_reason,
      finalizedAt: item.finalized_at,
      legs: legsByRecord.get(item.id) ?? [],
      canEdit: item.status === 'active' && (isAdmin || item.created_by === user.id),
      canDelete: item.status === 'active' && (isAdmin || item.created_by === user.id),
    })),
    recordsTotal,
  };
}

/** Danh mục dùng để lập kỳ tính: nhân viên, địa điểm, giá xăng, quãng đường đã lưu. */
function fuelCatalog(db, user, isAdmin, fuelTypes) {
  const employee = currentEmployee(db, user, isAdmin);
  const employees = isAdmin
    ? db
        .prepare(
          'SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE',
        )
        .all()
    : employee
      ? [employee]
      : [];
  const prices = db
    .prepare('SELECT * FROM fuel_prices ORDER BY effective_date DESC, fuel_type, region')
    .all();
  const distances = db
    .prepare(
      'SELECT id, from_name, to_name, distance_km FROM route_distances ORDER BY updated_at DESC',
    )
    .all();
  const locations = [
    ...db
      .prepare(
        "SELECT id, customer_name AS name, address, 'customer' AS type FROM customers WHERE trim(customer_name) <> ''",
      )
      .all(),
    ...db
      .prepare(
        "SELECT id, name, address, delivery_point, 'carrier' AS type FROM carriers WHERE is_active = 1 AND trim(name) <> ''",
      )
      .all(),
    ...db
      .prepare(
        "SELECT id, full_name AS name, address, 'employee' AS type FROM employees WHERE is_active = 1 AND trim(full_name) <> ''",
      )
      .all(),
  ].sort((left, right) => left.name.localeCompare(right.name, 'vi'));

  return {
    prices: prices.map(toFuelPrice),
    employees: employees.map((item) => ({ id: item.id, name: item.full_name })),
    currentEmployee: employee ? { id: employee.id, name: employee.full_name } : null,
    locations: locations.map((item) => ({
      id: item.id,
      name: item.name,
      address: item.address,
      type: item.type,
      deliveryPoint: item.delivery_point || '',
    })),
    distances: distances.map((item) => ({
      id: item.id,
      from: item.from_name,
      to: item.to_name,
      km: item.distance_km,
    })),
    fuelTypes,
    consumptionProfiles: consumptionProfiles(db),
    isAdmin,
  };
}

function listFuelData(db, user, isAdmin, query, fuelTypes) {
  return {
    ...fuelCatalog(db, user, isAdmin, fuelTypes),
    ...fuelHistory(db, user, isAdmin, query),
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
            vehicle_type, fuel_price, total_fee, extra_costs, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.vehicleType,
          input.fuelPrice,
          totalFee,
          JSON.stringify(input.extraCosts),
          user.id,
          at,
          at,
        );
      recordId = Number(result.lastInsertRowid);
    } else {
      db.prepare(
        `UPDATE fuel_records SET
           entry_date = ?, period_from = ?, period_to = ?, employee_id = ?,
           distance_km = ?, consumption_liters = ?, consumption_base_km = ?,
           fuel_type = ?, region = ?, vehicle_type = ?, fuel_price = ?, total_fee = ?, extra_costs = ?, updated_at = ?
           WHERE id = ?`,
      ).run(
        input.periodTo,
        input.periodFrom,
        input.periodTo,
        employeeId,
        input.distanceKm,
        input.consumptionLiters,
        input.consumptionBaseKm,
        input.fuelType,
        input.region,
        input.vehicleType,
        input.fuelPrice,
        totalFee,
        JSON.stringify(input.extraCosts),
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
  if (record.status !== 'active') throw badRequest('Lần tính này đã được hủy.');
  if (!isAdmin && record.created_by !== user.id) {
    throw badRequest('Bạn chỉ được sửa lần tính do mình tạo.');
  }
  return record;
}

function deleteFuelRecord(db, id, user, isAdmin) {
  const record = db.prepare('SELECT * FROM fuel_records WHERE id = ?').get(id);
  if (!record) throw notFound('Không tìm thấy lần tính xăng.');
  if (record.status !== 'active') throw badRequest('Lần tính này đã được hủy.');

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
  return { ok: true };
}

module.exports = {
  activeEmployee,
  consumptionProfiles,
  fuelHistory,
  listFuelData,
  saveFuelRecord,
  editableRecord,
  deleteFuelRecord,
};
