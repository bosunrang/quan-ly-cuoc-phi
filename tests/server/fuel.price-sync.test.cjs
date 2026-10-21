'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  syncPetrolimexE10Price,
  syncPetrolimexE10PriceWhenDue,
} = require('../../server/fuel/price-sync.cjs');

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'cuocphi-fuel-price-sync-'));
  const db = new DatabaseSync(join(directory, 'test.sqlite'));
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, is_admin INTEGER NOT NULL, is_active INTEGER NOT NULL);
    CREATE TABLE fuel_prices (
      id INTEGER PRIMARY KEY,
      effective_date TEXT NOT NULL,
      fuel_type TEXT NOT NULL,
      region TEXT NOT NULL,
      price INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(effective_date, fuel_type, region)
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      user_id INTEGER,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT
    );
    INSERT INTO users (id, is_admin, is_active) VALUES (1, 1, 1);
  `);
  return { db, directory };
}

function petrolimexPrice(priceDate, region1) {
  return async () => ({
    priceDate,
    source: 'Petrolimex · Giá bán lẻ trực tuyến',
    items: [{ name: 'Xăng E10 RON 95-III', region1, region2: region1 + 500 }],
  });
}

test('tự lưu giá Xăng E10 RON 95-III Vùng 1 theo từng ngày điều chỉnh', async () => {
  const { db, directory } = testDatabase();
  try {
    assert.deepEqual(await syncPetrolimexE10Price(db, petrolimexPrice('2026-10-15', 26_720)), {
      changed: true,
      price: 26_720,
      effectiveDate: '2026-10-15',
    });
    assert.deepEqual(await syncPetrolimexE10Price(db, petrolimexPrice('2026-10-15', 26_720)), {
      changed: false,
      price: 26_720,
      effectiveDate: '2026-10-15',
    });
    assert.deepEqual(await syncPetrolimexE10Price(db, petrolimexPrice('2026-10-22', 25_900)), {
      changed: true,
      price: 25_900,
      effectiveDate: '2026-10-22',
    });
    const savedPrices = db
      .prepare(
        'SELECT effective_date, fuel_type, region, price FROM fuel_prices ORDER BY effective_date',
      )
      .all()
      .map((item) => ({ ...item }));
    assert.deepEqual(savedPrices, [
      { effective_date: '2026-10-15', fuel_type: 'Xăng E10', region: 'region1', price: 26_720 },
      { effective_date: '2026-10-22', fuel_type: 'Xăng E10', region: 'region1', price: 25_900 },
    ]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('không ghi đè mốc giá được nhập tay cùng ngày', async () => {
  const { db, directory } = testDatabase();
  try {
    db.prepare(
      `INSERT INTO fuel_prices
       (effective_date, fuel_type, region, price, source, created_by, created_at, updated_at)
       VALUES ('2026-10-15', 'Xăng E10', 'region1', 26_000, 'Nhập tay', 1, '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z')`,
    ).run();
    const result = await syncPetrolimexE10Price(db, petrolimexPrice('2026-10-15', 26_720));
    assert.deepEqual(result, { changed: false, price: 26_000, effectiveDate: '2026-10-15' });
    assert.equal(db.prepare('SELECT price FROM fuel_prices').get().price, 26_000);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('không gọi lại Petrolimex trong thời gian chờ đồng bộ', async () => {
  const { db, directory } = testDatabase();
  let calls = 0;
  const fetchPrices = async () => {
    calls += 1;
    return petrolimexPrice('2026-10-15', 26_720)();
  };
  try {
    const first = await syncPetrolimexE10PriceWhenDue(db, fetchPrices, 1_000);
    const second = await syncPetrolimexE10PriceWhenDue(db, fetchPrices, 2_000);
    assert.equal(first.changed, true);
    assert.deepEqual(second, { changed: false, skipped: true });
    assert.equal(calls, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('cho phép thử lại sau khi đồng bộ thất bại', async () => {
  const { db, directory } = testDatabase();
  let calls = 0;
  const fetchPrices = async () => {
    calls += 1;
    if (calls === 1) throw new Error('Mạng tạm lỗi');
    return petrolimexPrice('2026-10-15', 26_720)();
  };
  try {
    await assert.rejects(syncPetrolimexE10PriceWhenDue(db, fetchPrices, 1_000), /Mạng tạm lỗi/);
    const result = await syncPetrolimexE10PriceWhenDue(db, fetchPrices, 2_000);
    assert.equal(result.changed, true);
    assert.equal(calls, 2);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
