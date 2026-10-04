'use strict';

const { normalizeSearchText } = require('../db.cjs');
const { cleanText } = require('./calculation.cjs');

const CACHE_LIMIT = 500;
const VIETMAP_TIMEOUT_MS = 15_000;
const vietmapRouteCache = new Map();
const vietmapPlaceCache = new Map();

function cacheResult(cache, key, value) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function routeKey(from, to) {
  return `${normalizeSearchText(from)}>${normalizeSearchText(to)}`;
}

function roundedKilometers(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round((value / 1000) * 10) / 10;
}

function vietmapUrl(path, params) {
  const url = new URL(path, 'https://maps.vietmap.vn');
  for (const [name, value] of params) url.searchParams.append(name, value);
  return url;
}

async function vietmapJson(url, failureMessage) {
  const response = await fetch(url, { signal: AbortSignal.timeout(VIETMAP_TIMEOUT_MS) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = cleanText(
      Array.isArray(payload?.messages) ? payload.messages.join(', ') : payload?.message,
      300,
    );
    throw new Error(detail || failureMessage);
  }
  return payload;
}

async function vietmapCoordinates(address, apiKey) {
  const key = normalizeSearchText(address);
  const cached = vietmapPlaceCache.get(key);
  if (cached) return cached;

  const matches = await vietmapJson(
    vietmapUrl('/api/search/v4', [
      ['apikey', apiKey],
      ['text', address],
      ['display_type', '5'],
    ]),
    'VietMap không tìm được địa chỉ',
  );
  const refId = cleanText(Array.isArray(matches) ? matches[0]?.ref_id : '', 1000);
  if (!refId) throw new Error('VietMap không tìm được địa chỉ');

  const place = await vietmapJson(
    vietmapUrl('/api/place/v4', [
      ['apikey', apiKey],
      ['refid', refId],
    ]),
    'VietMap không lấy được tọa độ địa chỉ',
  );
  const lat = Number(place?.lat);
  const lng = Number(place?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('VietMap không lấy được tọa độ địa chỉ');
  }
  return cacheResult(vietmapPlaceCache, key, { lat, lng });
}

async function vietmapRouteDistance(from, to, apiKey) {
  const key = routeKey(from, to);
  const cached = vietmapRouteCache.get(key);
  if (cached) return cached;

  const [origin, destination] = await Promise.all([
    vietmapCoordinates(from, apiKey),
    vietmapCoordinates(to, apiKey),
  ]);
  const payload = await vietmapJson(
    vietmapUrl('/api/route/v4', [
      ['apikey', apiKey],
      ['point', `${origin.lat},${origin.lng}`],
      ['point', `${destination.lat},${destination.lng}`],
      ['vehicle', 'car'],
      ['points_encoded', 'true'],
    ]),
    'VietMap không thể tính tuyến đường',
  );
  const detail = cleanText(
    Array.isArray(payload?.messages) ? payload.messages.join(', ') : payload?.messages,
    300,
  );
  if (payload?.code && payload.code !== 'OK') {
    throw new Error(detail || 'VietMap không thể tính tuyến đường');
  }
  const km = roundedKilometers(payload?.paths?.[0]?.distance);
  if (!km) throw new Error('VietMap không trả về quãng đường');
  return cacheResult(vietmapRouteCache, key, {
    km,
    source: 'VietMap',
    estimated: false,
  });
}

function saveRouteLegs(db, recordId, legs, at) {
  const saveLeg = db.prepare(
    'INSERT INTO fuel_record_legs (fuel_record_id, sequence_no, from_name, to_name, distance_km) VALUES (?, ?, ?, ?, ?)',
  );
  const saveDistance = db.prepare(
    `INSERT INTO route_distances
       (from_name, to_name, from_key, to_key, distance_km, source, updated_at)
     VALUES (?, ?, ?, ?, ?, 'record', ?)
     ON CONFLICT(from_key, to_key) DO UPDATE SET
       from_name = excluded.from_name, to_name = excluded.to_name,
       distance_km = excluded.distance_km, source = excluded.source,
       updated_at = excluded.updated_at`,
  );
  legs.forEach((leg, index) => {
    saveLeg.run(recordId, index + 1, leg.from, leg.to, leg.km);
    // Km trên phiếu (kể cả người dùng sửa tay) là dữ liệu lộ trình chuẩn
    // của ứng dụng và được tái sử dụng ở kỳ sau.
    saveDistance.run(
      leg.from,
      leg.to,
      normalizeSearchText(leg.from),
      normalizeSearchText(leg.to),
      leg.km,
      at,
    );
  });
}

function saveVietmapDistance(db, from, to, distanceKm) {
  db.prepare(
    `INSERT INTO route_distances
       (from_name, to_name, from_key, to_key, distance_km, source, updated_at)
     VALUES (?, ?, ?, ?, ?, 'vietmap', ?)
     ON CONFLICT(from_key, to_key) DO UPDATE SET
       from_name = excluded.from_name, to_name = excluded.to_name,
       distance_km = excluded.distance_km, source = excluded.source,
       updated_at = excluded.updated_at`,
  ).run(
    from,
    to,
    normalizeSearchText(from),
    normalizeSearchText(to),
    distanceKm,
    new Date().toISOString(),
  );
}

async function estimateRoute({ db, from, to, vietmapApiKey }) {
  const fromKey = normalizeSearchText(from);
  const toKey = normalizeSearchText(to);
  const saved = db
    .prepare('SELECT distance_km FROM route_distances WHERE from_key = ? AND to_key = ?')
    .get(fromKey, toKey);
  if (saved) {
    return { km: saved.distance_km, source: 'Chặng đã lưu trong ứng dụng', estimated: false };
  }
  const reverseSaved = db
    .prepare('SELECT distance_km FROM route_distances WHERE from_key = ? AND to_key = ?')
    .get(toKey, fromKey);
  if (reverseSaved) {
    return {
      km: reverseSaved.distance_km,
      source: 'Chặng ngược đã lưu trong ứng dụng',
      estimated: false,
    };
  }
  if (!vietmapApiKey) {
    throw new Error('Chưa cấu hình VIETMAP_API_KEY trên máy chủ.');
  }
  const result = await vietmapRouteDistance(from, to, vietmapApiKey);
  saveVietmapDistance(db, from, to, result.km);
  return result;
}

module.exports = { estimateRoute, saveRouteLegs };
