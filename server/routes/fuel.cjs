'use strict';

const { transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest, notFound } = require('../http.cjs');
const { canSeeEveryone } = require('../permissions.cjs');
const {
  FUEL_TYPES, cleanText, fuelConsumptionInput, fuelPriceInput, fuelRecordInput, toFuelPrice,
} = require('../fuel/calculation.cjs');
const { estimateRoute } = require('../fuel/routes.cjs');
const { fetchPetrolimexPrices } = require('../fuel/online-prices.cjs');
const {
  activeEmployee, consumptionProfiles, listFuelData, saveFuelRecord, editableRecord, deleteFuelRecord,
} = require('../fuel/records.cjs');

const PAGE = 'fuel';

function applyConfiguredConsumption(db, input) {
  const vehicleType = input.vehicleType === 'truck' ? 'truck' : 'motorcycle';
  const profile = consumptionProfiles(db)[vehicleType];
  return {
    ...input,
    vehicleType,
    consumptionLiters: profile.consumptionLiters,
    consumptionBaseKm: profile.consumptionBaseKm,
  };
}

function register(router) {
  router.get('/api/fuel', async (c) => {
    c.requirePage(PAGE);
    const isAdmin = canSeeEveryone(c.user);
    return listFuelData(c.db, c.user, isAdmin, c.query, FUEL_TYPES);
  });

  router.post('/api/fuel/prices', async (c) => {
    c.requirePage(PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Chỉ quản trị viên được cập nhật giá xăng.');
    const input = fuelPriceInput(c.body);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      c.db.prepare(
        `INSERT INTO fuel_prices
         (effective_date, fuel_type, region, price, source, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(effective_date, fuel_type, region) DO UPDATE SET
           price = excluded.price, source = excluded.source,
           created_by = excluded.created_by, updated_at = excluded.updated_at`,
      ).run(input.effectiveDate, input.fuelType, input.region, input.price, input.source, c.user.id, at, at);
      const row = c.db.prepare(
        'SELECT * FROM fuel_prices WHERE effective_date = ? AND fuel_type = ? AND region = ?',
      ).get(input.effectiveDate, input.fuelType, input.region);
      writeAudit(c.db, c.user, 'fuel.price.upsert', 'fuel_price', row.id, input);
      return toFuelPrice(row);
    });
  });

  router.delete('/api/fuel/prices/:id', async (c) => {
    c.requirePage(PAGE);
    if (!canSeeEveryone(c.user)) throw badRequest('Chỉ quản trị viên được xóa giá xăng.');
    const row = c.db.prepare('SELECT * FROM fuel_prices WHERE id = ?').get(Number(c.params.id));
    if (!row) throw notFound('Không tìm thấy mốc giá xăng.');
    c.db.prepare('DELETE FROM fuel_prices WHERE id = ?').run(row.id);
    writeAudit(c.db, c.user, 'fuel.price.delete', 'fuel_price', row.id, toFuelPrice(row));
    return { ok: true };
  });

  router.patch('/api/fuel/consumption', async (c) => {
    c.requirePage(PAGE);
    if (!canSeeEveryone(c.user)) {
      throw badRequest('Chỉ quản trị viên trên máy chủ được thiết lập định mức.');
    }
    const input = fuelConsumptionInput(c.body);
    const columns = input.vehicleType === 'truck'
      ? ['truck_consumption_liters', 'truck_base_km']
      : ['motorcycle_consumption_liters', 'motorcycle_base_km'];
    transaction(c.db, () => {
      c.db.prepare(
        `UPDATE app_settings SET ${columns[0]} = ?, ${columns[1]} = ?, updated_at = ? WHERE id = 1`,
      ).run(input.consumptionLiters, input.consumptionBaseKm, new Date().toISOString());
      writeAudit(c.db, c.user, 'settings.update', 'fuel_consumption', input.vehicleType, input);
    });
    return consumptionProfiles(c.db);
  });

  router.get('/api/fuel/online', async (c) => {
    c.requirePage(PAGE);
    try {
      return await fetchPetrolimexPrices();
    } catch {
      throw badRequest('Không lấy được giá Petrolimex online lúc này. Bạn vẫn có thể nhập tay.');
    }
  });

  router.post('/api/fuel/route-estimate', async (c) => {
    c.requirePage(PAGE);
    const from = cleanText(c.body.from, 250);
    const to = cleanText(c.body.to, 250);
    if (!from || !to) throw badRequest('Vui lòng nhập điểm đi và điểm đến trước khi lấy km.');
    const vietmapApiKey = cleanText(process.env.VIETMAP_API_KEY, 250);
    try {
      return await estimateRoute({ db: c.db, from, to, vietmapApiKey });
    } catch (cause) {
      const message = cause instanceof Error ? cleanText(cause.message, 320) : '';
      throw badRequest(`VietMap không lấy được km: ${message || 'kiểm tra lại API key và hạn mức.'}`);
    }
  });

  router.post('/api/fuel/records', async (c) => {
    c.requirePage(PAGE);
    const isAdmin = canSeeEveryone(c.user);
    const parsed = fuelRecordInput(c.body);
    const input = isAdmin ? parsed : applyConfiguredConsumption(c.db, parsed);
    const employee = activeEmployee(c.db, c.user, isAdmin, c.body.employeeId);
    return saveFuelRecord(c.db, c.user, input, employee.id);
  });

  router.patch('/api/fuel/records/:id', async (c) => {
    c.requirePage(PAGE);
    const id = Number(c.params.id);
    const isAdmin = canSeeEveryone(c.user);
    editableRecord(c.db, id, c.user, isAdmin);
    const parsed = fuelRecordInput(c.body);
    const input = isAdmin ? parsed : applyConfiguredConsumption(c.db, parsed);
    const employee = activeEmployee(c.db, c.user, isAdmin, c.body.employeeId);
    return saveFuelRecord(c.db, c.user, input, employee.id, id);
  });

  router.delete('/api/fuel/records/:id', async (c) => {
    c.requirePage(PAGE);
    return deleteFuelRecord(
      c.db,
      Number(c.params.id),
      c.user,
      canSeeEveryone(c.user),
    );
  });
}

module.exports = { register };
