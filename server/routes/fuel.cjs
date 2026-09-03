'use strict';

const { normalizeSearchText, transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest, notFound } = require('../http.cjs');
const { canSeeEveryone } = require('../permissions.cjs');

const PAGE = 'fuel';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['Xăng E10', 'Xăng RON 95-III', 'Xăng E5 RON 92', 'Dầu Diesel 0.05S'];
const regions = new Set(['region1', 'region2']);
const clean = (value, max = 100) => String(value ?? '').trim().slice(0, max);
const number = (value, field, integer = false) => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (integer && !Number.isInteger(result))) throw badRequest(`${field} không hợp lệ.`);
  return result;
};
function priceInput(body) {
  const effectiveDate = clean(body.effectiveDate, 10);
  if (!DATE.test(effectiveDate)) throw badRequest('Ngày hiệu lực không hợp lệ.');
  const fuelType = clean(body.fuelType);
  if (!fuelType) throw badRequest('Vui lòng chọn loại nhiên liệu.');
  const region = clean(body.region);
  if (!regions.has(region)) throw badRequest('Khu vực giá không hợp lệ.');
  return { effectiveDate, fuelType, region, price: number(body.price, 'Giá xăng', true), source: clean(body.source, 150) || 'Nhập tay' };
}
function toPrice(row) { return { id: row.id, effectiveDate: row.effective_date, fuelType: row.fuel_type, region: row.region, price: row.price, source: row.source }; }
function register(router) {
  router.get('/api/fuel', async (c) => {
    c.requirePage(PAGE);
    const prices = c.db.prepare('SELECT * FROM fuel_prices ORDER BY effective_date DESC, fuel_type, region').all();
    const employees = c.db.prepare('SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all();
    const scope = canSeeEveryone(c.user);
    const limit = Math.min(Math.max(Number(c.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(c.query.offset) || 0, 0);
    const employeeId = Number(c.query.employeeId) || null;
    const conditions = [];
    const params = [];
    if (!scope) {
      conditions.push('f.created_by = ?');
      params.push(c.user.id);
    }
    if (employeeId) {
      conditions.push('f.employee_id = ?');
      params.push(employeeId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const recordsTotal = Number(
      c.db.prepare(`SELECT COUNT(*) AS count FROM fuel_records f ${where}`).get(...params).count,
    );
    const records = c.db.prepare(`SELECT f.*, e.full_name AS employee_name FROM fuel_records f LEFT JOIN employees e ON e.id = f.employee_id ${where} ORDER BY f.entry_date DESC, f.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const distances = c.db.prepare('SELECT id, from_name, to_name, distance_km FROM route_distances ORDER BY updated_at DESC LIMIT 500').all();
    const locations = [
      ...c.db.prepare("SELECT id, customer_name AS name, address, 'customer' AS type FROM customers WHERE trim(address) <> ''").all(),
      ...c.db.prepare("SELECT id, name, address, 'carrier' AS type FROM carriers WHERE is_active = 1 AND trim(address) <> ''").all(),
      ...c.db.prepare("SELECT id, full_name AS name, address, 'employee' AS type FROM employees WHERE is_active = 1 AND trim(address) <> ''").all(),
    ].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    return { prices: prices.map(toPrice), employees: employees.map((item) => ({ id: item.id, name: item.full_name })), locations, distances: distances.map((item) => ({ id: item.id, from: item.from_name, to: item.to_name, km: item.distance_km })), records: records.map((item) => ({ id: item.id, entryDate: item.entry_date, periodFrom: item.period_from || item.entry_date, periodTo: item.period_to || item.entry_date, employeeId: item.employee_id, employeeName: item.employee_name, distanceKm: item.distance_km, fuelType: item.fuel_type, region: item.region, fuelPrice: item.fuel_price, totalFee: item.total_fee })), recordsTotal, fuelTypes: TYPES, isAdmin: scope };
  });
  router.post('/api/fuel/prices', async (c) => {
    c.requirePage(PAGE); if (!canSeeEveryone(c.user)) throw badRequest('Chỉ quản trị viên được cập nhật giá xăng.');
    const input = priceInput(c.body); const at = new Date().toISOString();
    return transaction(c.db, () => { c.db.prepare(`INSERT INTO fuel_prices (effective_date, fuel_type, region, price, source, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(effective_date, fuel_type, region) DO UPDATE SET price = excluded.price, source = excluded.source, created_by = excluded.created_by, updated_at = excluded.updated_at`).run(input.effectiveDate, input.fuelType, input.region, input.price, input.source, c.user.id, at, at); const row = c.db.prepare('SELECT * FROM fuel_prices WHERE effective_date = ? AND fuel_type = ? AND region = ?').get(input.effectiveDate, input.fuelType, input.region); writeAudit(c.db, c.user, 'fuel.price.upsert', 'fuel_price', row.id, input); return toPrice(row); });
  });
  router.delete('/api/fuel/prices/:id', async (c) => { c.requirePage(PAGE); if (!canSeeEveryone(c.user)) throw badRequest('Chỉ quản trị viên được xóa giá xăng.'); const row = c.db.prepare('SELECT * FROM fuel_prices WHERE id = ?').get(Number(c.params.id)); if (!row) throw notFound('Không tìm thấy mốc giá xăng.'); c.db.prepare('DELETE FROM fuel_prices WHERE id = ?').run(row.id); writeAudit(c.db, c.user, 'fuel.price.delete', 'fuel_price', row.id, toPrice(row)); return { ok: true }; });
  router.get('/api/fuel/online', async (c) => {
    c.requirePage(PAGE);
    try {
      const response = await fetch('https://giahomnay.site/gia-xang', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      const html = await response.text();
      const items = [];
      const pattern = /<tr[^>]*>[\s\S]*?<p[^>]*>([^<]+)<\/p>[\s\S]*?<td[^>]*data-value[^>]*>([\d.]+)<\/td>[\s\S]*?<td[^>]*data-value[^>]*>([\d.]+)<\/td>/g;
      for (const match of html.matchAll(pattern)) {
        const region1 = Number(match[2].replaceAll('.', ''));
        const region2 = Number(match[3].replaceAll('.', ''));
        if (match[1] && Number.isFinite(region1) && Number.isFinite(region2)) items.push({ name: match[1].trim(), region1, region2 });
      }
      if (!items.length) throw new Error();
      const date = /hôm nay ngày (\d{2})\/(\d{2})\/(\d{4})/i.exec(html);
      return { priceDate: date ? `${date[3]}-${date[2]}-${date[1]}` : '', source: 'Giá Hôm Nay · Petrolimex', items };
    } catch { throw badRequest('Không lấy được giá xăng online lúc này. Bạn vẫn có thể nhập tay.'); }
  });
  router.post('/api/fuel/records', async (c) => {
    c.requirePage(PAGE);
    const periodFrom = clean(c.body.periodFrom ?? c.body.entryDate, 10), periodTo = clean(c.body.periodTo ?? c.body.entryDate, 10);
    if (!DATE.test(periodFrom) || !DATE.test(periodTo) || periodFrom > periodTo) throw badRequest('Khoảng ngày tính không hợp lệ.');
    const consumptionLiters = number(c.body.consumptionLiters, 'Mức tiêu hao'), consumptionBaseKm = number(c.body.consumptionBaseKm, 'Định mức km');
    if (!consumptionBaseKm) throw badRequest('Định mức km phải lớn hơn 0.');
    const legs = Array.isArray(c.body.legs) ? c.body.legs.slice(0, 50).map((leg) => ({ from: clean(leg?.from), to: clean(leg?.to), km: number(leg?.km, 'Quãng đường') })).filter((leg) => leg.from && leg.to && leg.km > 0) : [];
    const distanceKm = legs.length ? legs.reduce((sum, leg) => sum + leg.km, 0) : number(c.body.distanceKm, 'Quãng đường');
    if (!distanceKm) throw badRequest('Vui lòng nhập quãng đường.');
    const fuelPrice = number(c.body.fuelPrice, 'Giá xăng', true), employeeId = Number(c.body.employeeId);
    const employee = c.db.prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1').get(employeeId);
    if (!employee) throw badRequest('Vui lòng chọn nhân viên đang hoạt động.');
    const totalFee = Math.round(distanceKm * consumptionLiters / consumptionBaseKm * fuelPrice), at = new Date().toISOString();
    return transaction(c.db, () => {
      const result = c.db.prepare('INSERT INTO fuel_records (entry_date, period_from, period_to, employee_id, distance_km, consumption_liters, consumption_base_km, fuel_type, region, fuel_price, total_fee, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(periodTo, periodFrom, periodTo, employeeId, distanceKm, consumptionLiters, consumptionBaseKm, clean(c.body.fuelType) || TYPES[0], regions.has(clean(c.body.region)) ? clean(c.body.region) : 'region1', fuelPrice, totalFee, c.user.id, at);
      const id = Number(result.lastInsertRowid), saveLeg = c.db.prepare('INSERT INTO fuel_record_legs (fuel_record_id, sequence_no, from_name, to_name, distance_km) VALUES (?, ?, ?, ?, ?)'), saveDistance = c.db.prepare('INSERT INTO route_distances (from_name, to_name, from_key, to_key, distance_km, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(from_key, to_key) DO UPDATE SET from_name = excluded.from_name, to_name = excluded.to_name, distance_km = excluded.distance_km, updated_at = excluded.updated_at');
      legs.forEach((leg, index) => { saveLeg.run(id, index + 1, leg.from, leg.to, leg.km); saveDistance.run(leg.from, leg.to, normalizeSearchText(leg.from), normalizeSearchText(leg.to), leg.km, at); });
      writeAudit(c.db, c.user, 'fuel.record.create', 'fuel_record', id, { periodFrom, periodTo, employeeId, distanceKm, totalFee, legs });
      return { id, totalFee };
    });
  });
}
module.exports = { register };
