'use strict';

const { normalizeSearchText, transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const { badRequest, notFound, isIsoDate } = require('../http.cjs');
const { canSeeEveryone } = require('../permissions.cjs');

const PAGE = 'fuel';
const TYPES = ['Xăng E10', 'Xăng RON 95-III', 'Xăng E5 RON 92', 'Dầu Diesel 0.05S'];
const regions = new Set(['region1', 'region2']);
const routeEstimateCache = new Map();
const googleRouteEstimateCache = new Map();
const clean = (value, max = 100) => String(value ?? '').trim().slice(0, max);
const number = (value, field, integer = false) => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (integer && !Number.isInteger(result))) throw badRequest(`${field} không hợp lệ.`);
  return result;
};
function priceInput(body) {
  const effectiveDate = clean(body.effectiveDate, 10);
  if (!isIsoDate(effectiveDate)) throw badRequest('Ngày hiệu lực không hợp lệ.');
  const fuelType = clean(body.fuelType);
  if (!fuelType) throw badRequest('Vui lòng chọn loại nhiên liệu.');
  const region = clean(body.region);
  if (!regions.has(region)) throw badRequest('Khu vực giá không hợp lệ.');
  return { effectiveDate, fuelType, region, price: number(body.price, 'Giá xăng', true), source: clean(body.source, 150) || 'Nhập tay' };
}
function toPrice(row) { return { id: row.id, effectiveDate: row.effective_date, fuelType: row.fuel_type, region: row.region, price: row.price, source: row.source }; }
function recordInput(body) {
  const periodFrom = clean(body.periodFrom ?? body.entryDate, 10);
  const periodTo = clean(body.periodTo ?? body.entryDate, 10);
  if (!isIsoDate(periodFrom) || !isIsoDate(periodTo) || periodFrom > periodTo) throw badRequest('Khoảng ngày tính không hợp lệ.');
  const consumptionLiters = number(body.consumptionLiters, 'Mức tiêu hao');
  const consumptionBaseKm = number(body.consumptionBaseKm, 'Định mức km');
  if (!consumptionBaseKm) throw badRequest('Định mức km phải lớn hơn 0.');
  const legs = Array.isArray(body.legs) ? body.legs.slice(0, 50).map((leg) => ({ from: clean(leg?.from), to: clean(leg?.to), km: number(leg?.km, 'Quãng đường') })).filter((leg) => leg.from && leg.to && leg.km > 0) : [];
  const distanceKm = legs.length ? legs.reduce((sum, leg) => sum + leg.km, 0) : number(body.distanceKm, 'Quãng đường');
  if (!distanceKm) throw badRequest('Vui lòng nhập quãng đường.');
  const fuelPrice = number(body.fuelPrice, 'Giá xăng', true);
  return { periodFrom, periodTo, consumptionLiters, consumptionBaseKm, legs, distanceKm, fuelPrice, fuelType: clean(body.fuelType) || TYPES[0], region: regions.has(clean(body.region)) ? clean(body.region) : 'region1' };
}
function saveRecordLegs(db, recordId, legs, at) {
  const saveLeg = db.prepare('INSERT INTO fuel_record_legs (fuel_record_id, sequence_no, from_name, to_name, distance_km) VALUES (?, ?, ?, ?, ?)');
  const saveDistance = db.prepare('INSERT INTO route_distances (from_name, to_name, from_key, to_key, distance_km, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(from_key, to_key) DO UPDATE SET from_name = excluded.from_name, to_name = excluded.to_name, distance_km = excluded.distance_km, updated_at = excluded.updated_at');
  legs.forEach((leg, index) => {
    saveLeg.run(recordId, index + 1, leg.from, leg.to, leg.km);
    saveDistance.run(leg.from, leg.to, normalizeSearchText(leg.from), normalizeSearchText(leg.to), leg.km, at);
  });
}
async function estimateGoogleRouteDistance(from, to, apiKey) {
  const cacheKey = `${normalizeSearchText(from)}>${normalizeSearchText(to)}`;
  if (googleRouteEstimateCache.has(cacheKey)) return googleRouteEstimateCache.get(cacheKey);
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { address: from },
      destination: { address: to },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      units: 'METRIC',
      languageCode: 'vi',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = clean(payload?.error?.message, 300);
    throw new Error(detail || 'Google Maps không thể tính tuyến đường');
  }
  const payload = await response.json();
  const meters = Number(payload?.routes?.[0]?.distanceMeters);
  if (!Number.isFinite(meters) || meters <= 0) throw new Error('Google Maps không trả về quãng đường');
  const result = { km: Math.round((meters / 1000) * 10) / 10, source: 'Google Maps', estimated: false };
  googleRouteEstimateCache.set(cacheKey, result);
  return result;
}
async function geocodeVietnameseAddress(address) {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=vn&q=${encodeURIComponent(address)}`, {
    headers: { 'User-Agent': 'QuanLyCuocPhi/1.0.2', 'Accept-Language': 'vi' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Không tìm được địa chỉ');
  const items = await response.json();
  const item = Array.isArray(items) ? items[0] : null;
  const lat = Number(item?.lat), lon = Number(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Không tìm được địa chỉ');
  return { lat, lon };
}
async function estimateRouteDistance(from, to) {
  const fromKey = normalizeSearchText(from), toKey = normalizeSearchText(to);
  const cacheKey = `${fromKey}>${toKey}`;
  if (routeEstimateCache.has(cacheKey)) return routeEstimateCache.get(cacheKey);
  const [start, end] = await Promise.all([geocodeVietnameseAddress(from), geocodeVietnameseAddress(to)]);
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=false`, {
    headers: { 'User-Agent': 'QuanLyCuocPhi/1.0.2' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Không tính được tuyến đường');
  const payload = await response.json();
  const meters = Number(payload?.routes?.[0]?.distance);
  if (!Number.isFinite(meters) || meters <= 0) throw new Error('Không tính được tuyến đường');
  const result = { km: Math.round((meters / 1000) * 10) / 10, source: 'OpenStreetMap / OSRM', estimated: true };
  routeEstimateCache.set(cacheKey, result);
  return result;
}
function register(router) {
  router.get('/api/fuel', async (c) => {
    c.requirePage(PAGE);
    const prices = c.db.prepare('SELECT * FROM fuel_prices ORDER BY effective_date DESC, fuel_type, region').all();
    const scope = canSeeEveryone(c.user);
    const currentEmployee = scope ? null : c.db.prepare('SELECT id, full_name FROM employees WHERE user_id = ? AND is_active = 1').get(c.user.id);
    const employees = scope
      ? c.db.prepare('SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all()
      : currentEmployee ? [currentEmployee] : [];
    const limit = Math.min(Math.max(Number(c.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(c.query.offset) || 0, 0);
    const employeeId = Number(c.query.employeeId) || null;
    const conditions = [];
    const params = [];
    if (!scope) {
      // Nhân viên xem toàn bộ lịch sử được gán cho mình, kể cả lần Admin lập hộ.
      // Quyền sửa/xóa phía dưới vẫn giới hạn theo người tạo bản ghi.
      conditions.push('f.employee_id = ?');
      params.push(currentEmployee?.id ?? -1);
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
    const legsForRecord = c.db.prepare('SELECT sequence_no, from_name, to_name, distance_km FROM fuel_record_legs WHERE fuel_record_id = ? ORDER BY sequence_no');
    return { prices: prices.map(toPrice), employees: employees.map((item) => ({ id: item.id, name: item.full_name })), currentEmployee: currentEmployee ? { id: currentEmployee.id, name: currentEmployee.full_name } : null, locations, distances: distances.map((item) => ({ id: item.id, from: item.from_name, to: item.to_name, km: item.distance_km })), records: records.map((item) => ({ id: item.id, entryDate: item.entry_date, periodFrom: item.period_from || item.entry_date, periodTo: item.period_to || item.entry_date, employeeId: item.employee_id, employeeName: item.employee_name, distanceKm: item.distance_km, consumptionLiters: item.consumption_liters, consumptionBaseKm: item.consumption_base_km, fuelType: item.fuel_type, region: item.region, fuelPrice: item.fuel_price, totalFee: item.total_fee, status: item.status, voidReason: item.void_reason, finalizedAt: item.finalized_at, legs: legsForRecord.all(item.id).map((leg) => ({ from: leg.from_name, to: leg.to_name, km: leg.distance_km })), canEdit: item.status === 'active' && !item.finalized_at && (scope || item.created_by === c.user.id), canDelete: item.status === 'active' && !item.finalized_at && (scope || item.created_by === c.user.id), canVoid: scope && item.status === 'active' && Boolean(item.finalized_at) })), recordsTotal, fuelTypes: TYPES, isAdmin: scope };
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
  router.post('/api/fuel/route-estimate', async (c) => {
    c.requirePage(PAGE);
    const from = clean(c.body.from, 250), to = clean(c.body.to, 250);
    if (!from || !to) throw badRequest('Vui lòng nhập điểm đi và điểm đến trước khi lấy km.');
    const fromKey = normalizeSearchText(from), toKey = normalizeSearchText(to);
    const saved = c.db.prepare('SELECT distance_km FROM route_distances WHERE from_key = ? AND to_key = ?').get(fromKey, toKey);
    if (saved) return { km: saved.distance_km, source: 'Chặng đã lưu trong ứng dụng', estimated: false };
    const reverseSaved = c.db.prepare('SELECT distance_km FROM route_distances WHERE from_key = ? AND to_key = ?').get(toKey, fromKey);
    if (reverseSaved) return { km: reverseSaved.distance_km, source: 'Chặng ngược đã lưu trong ứng dụng', estimated: true };
    const googleApiKey = clean(process.env.GOOGLE_MAPS_API_KEY, 250);
    try { return googleApiKey ? await estimateGoogleRouteDistance(from, to, googleApiKey) : await estimateRouteDistance(from, to); }
    catch (cause) {
      const message = cause instanceof Error ? clean(cause.message, 320) : '';
      throw badRequest(googleApiKey ? `Google Maps không lấy được km: ${message || 'kiểm tra lại key và thanh toán.'}` : 'Không lấy được km tự động lúc này. Bạn có thể nhập km theo Google Maps.');
    }
  });
  router.post('/api/fuel/records', async (c) => {
    c.requirePage(PAGE);
    const input = recordInput(c.body);
    const employee = canSeeEveryone(c.user)
      ? c.db.prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1').get(Number(c.body.employeeId))
      : c.db.prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1').get(c.user.id);
    if (!employee) throw badRequest('Vui lòng chọn nhân viên đang hoạt động.');
    const employeeId = employee.id;
    const totalFee = Math.round(input.distanceKm * input.consumptionLiters / input.consumptionBaseKm * input.fuelPrice), at = new Date().toISOString();
    return transaction(c.db, () => {
      const result = c.db.prepare('INSERT INTO fuel_records (entry_date, period_from, period_to, employee_id, distance_km, consumption_liters, consumption_base_km, fuel_type, region, fuel_price, total_fee, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(input.periodTo, input.periodFrom, input.periodTo, employeeId, input.distanceKm, input.consumptionLiters, input.consumptionBaseKm, input.fuelType, input.region, input.fuelPrice, totalFee, c.user.id, at, at);
      const id = Number(result.lastInsertRowid);
      saveRecordLegs(c.db, id, input.legs, at);
      writeAudit(c.db, c.user, 'fuel.record.create', 'fuel_record', id, { ...input, employeeId, totalFee });
      return { id, totalFee };
    });
  });
  router.patch('/api/fuel/records/:id', async (c) => {
    c.requirePage(PAGE);
    const id = Number(c.params.id);
    const record = c.db.prepare('SELECT * FROM fuel_records WHERE id = ?').get(id);
    if (!record) throw notFound('Không tìm thấy lần tính xăng.');
    const scope = canSeeEveryone(c.user);
    if (record.status !== 'active' || record.finalized_at) throw badRequest('Lần tính đã chốt; chỉ quản trị viên có thể hủy kèm lý do.');
    if (!scope && record.created_by !== c.user.id) throw badRequest('Bạn chỉ được sửa lần tính do mình tạo.');
    const input = recordInput(c.body);
    const employee = scope
      ? c.db.prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1').get(Number(c.body.employeeId))
      : c.db.prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1').get(c.user.id);
    if (!employee) throw badRequest('Vui lòng chọn nhân viên đang hoạt động.');
    const totalFee = Math.round(input.distanceKm * input.consumptionLiters / input.consumptionBaseKm * input.fuelPrice);
    const at = new Date().toISOString();
    return transaction(c.db, () => {
      c.db.prepare('UPDATE fuel_records SET entry_date = ?, period_from = ?, period_to = ?, employee_id = ?, distance_km = ?, consumption_liters = ?, consumption_base_km = ?, fuel_type = ?, region = ?, fuel_price = ?, total_fee = ?, updated_at = ? WHERE id = ?').run(input.periodTo, input.periodFrom, input.periodTo, employee.id, input.distanceKm, input.consumptionLiters, input.consumptionBaseKm, input.fuelType, input.region, input.fuelPrice, totalFee, at, id);
      c.db.prepare('DELETE FROM fuel_record_legs WHERE fuel_record_id = ?').run(id);
      saveRecordLegs(c.db, id, input.legs, at);
      writeAudit(c.db, c.user, 'fuel.record.update', 'fuel_record', id, { ...input, employeeId: employee.id, totalFee });
      return { id, totalFee };
    });
  });
  router.delete('/api/fuel/records/:id', async (c) => {
    c.requirePage(PAGE);
    const id = Number(c.params.id);
    const record = c.db.prepare('SELECT * FROM fuel_records WHERE id = ?').get(id);
    if (!record) throw notFound('Không tìm thấy lần tính xăng.');
    const scope = canSeeEveryone(c.user);
    if (record.status !== 'active') throw badRequest('Lần tính này đã được hủy.');
    if (record.finalized_at) {
      if (!scope) throw badRequest('Lần tính đã chốt; vui lòng liên hệ quản trị viên để hủy.');
      const reason = clean(c.body.reason, 300);
      if (!reason) throw badRequest('Vui lòng nhập lý do hủy lần tính đã chốt.');
      const at = new Date().toISOString();
      c.db.prepare("UPDATE fuel_records SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?, updated_at = ? WHERE id = ?").run(at, c.user.id, reason, at, id);
      writeAudit(c.db, c.user, 'fuel.record.void', 'fuel_record', id, { reason });
      return { ok: true, voided: true };
    }
    if (!scope && record.created_by !== c.user.id) throw badRequest('Bạn chỉ được xóa lần tính do mình tạo.');
    transaction(c.db, () => {
      c.db.prepare('DELETE FROM fuel_records WHERE id = ?').run(id);
      writeAudit(c.db, c.user, 'fuel.record.delete', 'fuel_record', id, { periodFrom: record.period_from, periodTo: record.period_to, totalFee: record.total_fee });
    });
    return { ok: true, voided: false };
  });
}
module.exports = { register };
