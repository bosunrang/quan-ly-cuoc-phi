'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { estimateRoute, saveRouteLegs } = require('../../server/fuel/routes.cjs');

function emptyRouteDatabase() {
  return { prepare: () => ({ get: () => undefined, run: () => undefined }) };
}

function json(payload) {
  return { ok: true, json: async () => payload };
}

test('lấy km VietMap bằng Search, Place rồi Route; API key không trả về client', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname === '/api/search/v4') {
      return json([{ ref_id: `geocode:${url.searchParams.get('text')}` }]);
    }
    if (url.pathname === '/api/place/v4') {
      const refId = url.searchParams.get('refid');
      return json(
        refId.includes('Điểm đi kiểm thử')
          ? { lat: 10.75, lng: 106.67 }
          : { lat: 10.8, lng: 106.72 },
      );
    }
    if (url.pathname === '/api/route/v4') {
      return json({ code: 'OK', paths: [{ distance: 12_345 }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const result = await estimateRoute({
      db: emptyRouteDatabase(),
      from: 'Điểm đi kiểm thử',
      to: 'Điểm đến kiểm thử',
      vietmapApiKey: 'private-vietmap-key',
    });
    assert.deepEqual(result, { km: 12.3, source: 'VietMap', estimated: false });
    assert.equal(calls.filter((url) => url.pathname === '/api/search/v4').length, 2);
    assert.equal(calls.filter((url) => url.pathname === '/api/place/v4').length, 2);
    const route = calls.find((url) => url.pathname === '/api/route/v4');
    assert.equal(route.searchParams.getAll('point').join('|'), '10.75,106.67|10.8,106.72');
    assert.equal(route.searchParams.get('vehicle'), 'car');
  } finally {
    global.fetch = originalFetch;
  }
});

test('yêu cầu cấu hình key khi không có km đã lưu', async () => {
  await assert.rejects(
    estimateRoute({
      db: emptyRouteDatabase(),
      from: 'Điểm A chưa lưu',
      to: 'Điểm B chưa lưu',
      vietmapApiKey: '',
    }),
    /VIETMAP_API_KEY/,
  );
});

test('dùng cache chiều ngược khi lộ trình đã được thiết lập', async () => {
  let reads = 0;
  const db = {
    prepare: () => ({
      get: () => {
        reads += 1;
        return reads === 2 ? { distance_km: 7 } : undefined;
      },
      run: () => undefined,
    }),
  };
  const result = await estimateRoute({ db, from: 'A', to: 'B', vietmapApiKey: '' });
  assert.deepEqual(result, {
    km: 7,
    source: 'Chặng ngược đã lưu trong ứng dụng',
    estimated: false,
  });
  assert.equal(reads, 2);
});

test('km nhập tay trong chứng từ ghi đè cache lộ trình dùng chung', () => {
  const statements = [];
  const db = {
    prepare: (sql) => {
      statements.push(sql);
      return { run: () => undefined };
    },
  };
  saveRouteLegs(db, 1, [{ from: 'A', to: 'B', km: 10 }], '2026-09-21T00:00:00Z');
  assert.equal(statements.length, 2);
  assert.match(statements[0], /fuel_record_legs/);
  assert.match(statements[1], /route_distances/);
});
