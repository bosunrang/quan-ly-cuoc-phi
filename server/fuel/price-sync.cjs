'use strict';

const { transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const { isIsoDate } = require('../http.cjs');

const E10_FUEL_TYPE = 'Xăng E10';
const REGION_1 = 'region1';
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const syncState = new WeakMap();

/**
 * Lưu giá Xăng E10 RON 95-III, Vùng 1 theo ngày điều chỉnh của Petrolimex.
 * Mốc nhập tay cùng ngày được giữ nguyên; nếu Petrolimex đính chính dữ liệu
 * của chính mốc tự động, lần đồng bộ sau sẽ cập nhật lại mốc đó.
 */
async function syncPetrolimexE10Price(db, fetchPrices) {
  const online = await fetchPrices();
  const price = online?.items?.find((item) => item.name === 'Xăng E10 RON 95-III')?.region1;
  if (
    !isIsoDate(online?.priceDate) ||
    typeof online.source !== 'string' ||
    !online.source.trim() ||
    !Number.isSafeInteger(price) ||
    price <= 0
  ) {
    throw new Error('Petrolimex chưa trả về giá Xăng E10 RON 95-III, Vùng 1 hợp lệ.');
  }

  const admin = db
    .prepare('SELECT id FROM users WHERE is_admin = 1 AND is_active = 1 ORDER BY id LIMIT 1')
    .get();
  if (!admin) throw new Error('Không tìm thấy tài khoản quản trị để lưu giá xăng tự động.');

  return transaction(db, () => {
    const existing = db
      .prepare(
        'SELECT * FROM fuel_prices WHERE effective_date = ? AND fuel_type = ? AND region = ?',
      )
      .get(online.priceDate, E10_FUEL_TYPE, REGION_1);
    const input = {
      effectiveDate: online.priceDate,
      fuelType: E10_FUEL_TYPE,
      region: REGION_1,
      price,
      source: online.source,
      automatic: true,
    };

    if (existing && existing.source !== online.source) {
      return { changed: false, price: existing.price, effectiveDate: online.priceDate };
    }
    if (existing && existing.price === price) {
      return { changed: false, price, effectiveDate: online.priceDate };
    }

    const at = new Date().toISOString();
    let rowId;
    if (existing) {
      db.prepare('UPDATE fuel_prices SET price = ?, source = ?, updated_at = ? WHERE id = ?').run(
        price,
        online.source,
        at,
        existing.id,
      );
      rowId = existing.id;
    } else {
      const inserted = db
        .prepare(
          `INSERT INTO fuel_prices
         (effective_date, fuel_type, region, price, source, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(online.priceDate, E10_FUEL_TYPE, REGION_1, price, online.source, admin.id, at, at);
      rowId = Number(inserted.lastInsertRowid);
    }

    writeAudit(db, { username: 'Hệ thống' }, 'fuel.price.upsert', 'fuel_price', rowId, input);
    return { changed: true, price, effectiveDate: online.priceDate };
  });
}

/** Không gọi lại Petrolimex cho mỗi lần đổi trang trong cùng phiên máy chủ. */
function syncPetrolimexE10PriceWhenDue(db, fetchPrices, now = Date.now()) {
  const state = syncState.get(db);
  if (state?.inFlight) return state.inFlight;
  if (state && now - state.lastSuccessAt < AUTO_SYNC_INTERVAL_MS) {
    return Promise.resolve({ changed: false, skipped: true });
  }
  const inFlight = syncPetrolimexE10Price(db, fetchPrices).then(
    (result) => {
      syncState.set(db, { lastSuccessAt: now, inFlight: null });
      return result;
    },
    (error) => {
      if (state) syncState.set(db, { lastSuccessAt: state.lastSuccessAt, inFlight: null });
      else syncState.delete(db);
      throw error;
    },
  );
  syncState.set(db, { lastSuccessAt: state?.lastSuccessAt ?? 0, inFlight });
  return inFlight;
}

module.exports = { syncPetrolimexE10Price, syncPetrolimexE10PriceWhenDue };
