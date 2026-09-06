'use strict';

const { normalizeSearchText } = require('../db.cjs');
const { cleanText } = require('./calculation.cjs');

const CACHE_LIMIT = 500;
const GOOGLE_TIMEOUT_MS = 15_000;
const FALLBACK_TIMEOUT_MS = 10_000;
const APP_USER_AGENT = 'QuanLyCuocPhi/1.0.3';
const googleRouteCache = new Map();
const fallbackRouteCache = new Map();

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

async function googleRouteDistance(from, to, apiKey) {
  const key = routeKey(from, to);
  const cached = googleRouteCache.get(key);
  if (cached) return cached;

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
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = cleanText(payload?.error?.message, 300);
    throw new Error(detail || 'Google Maps không thể tính tuyến đường');
  }
  const payload = await response.json();
  const km = roundedKilometers(payload?.routes?.[0]?.distanceMeters);
  if (!km) throw new Error('Google Maps không trả về quãng đường');
  return cacheResult(googleRouteCache, key, {
    km,
    source: 'Google Maps',
    estimated: false,
  });
}

async function geocodeVietnameseAddress(address) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=vn&q=${encodeURIComponent(address)}`,
    {
      headers: { 'User-Agent': APP_USER_AGENT, 'Accept-Language': 'vi' },
      signal: AbortSignal.timeout(FALLBACK_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error('Không tìm được địa chỉ');
  const items = await response.json();
  const item = Array.isArray(items) ? items[0] : null;
  const lat = Number(item?.lat);
  const lon = Number(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Không tìm được địa chỉ');
  }
  return { lat, lon };
}

async function fallbackRouteDistance(from, to) {
  const key = routeKey(from, to);
  const cached = fallbackRouteCache.get(key);
  if (cached) return cached;

  const [start, end] = await Promise.all([
    geocodeVietnameseAddress(from),
    geocodeVietnameseAddress(to),
  ]);
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=false`,
    {
      headers: { 'User-Agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(FALLBACK_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error('Không tính được tuyến đường');
  const payload = await response.json();
  const km = roundedKilometers(payload?.routes?.[0]?.distance);
  if (!km) throw new Error('Không tính được tuyến đường');
  return cacheResult(fallbackRouteCache, key, {
    km,
    source: 'OpenStreetMap / OSRM',
    estimated: true,
  });
}

function saveRouteLegs(db, recordId, legs, at) {
  const saveLeg = db.prepare(
    'INSERT INTO fuel_record_legs (fuel_record_id, sequence_no, from_name, to_name, distance_km) VALUES (?, ?, ?, ?, ?)',
  );
  const saveDistance = db.prepare(
    `INSERT INTO route_distances
       (from_name, to_name, from_key, to_key, distance_km, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(from_key, to_key) DO UPDATE SET
       distance_km = excluded.distance_km, updated_at = excluded.updated_at`,
  );
  legs.forEach((leg, index) => {
    saveLeg.run(recordId, index + 1, leg.from, leg.to, leg.km);
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

async function estimateRoute({ db, from, to, googleApiKey }) {
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
    return { km: reverseSaved.distance_km, source: 'Chặng ngược đã lưu trong ứng dụng', estimated: true };
  }
  return googleApiKey
    ? googleRouteDistance(from, to, googleApiKey)
    : fallbackRouteDistance(from, to);
}

module.exports = { estimateRoute, saveRouteLegs };
