'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fetchPetrolimexPrices } = require('../../server/fuel/online-prices.cjs');

test('đọc giá xăng từ dữ liệu Petrolimex chính thức', async () => {
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (input) => {
    requestedUrl = new URL(input);
    return {
      ok: true,
      json: async () => ({
        Objects: [
          {
            Title: 'Xăng E10 RON 95-III',
            Zone1Price: 20_220,
            Zone2Price: 20_620,
            LastModified: '2026-09-17T08:00:00Z',
          },
          { Title: 'Dầu Diesel', Zone1Price: 0, Zone2Price: 0 },
        ],
      }),
    };
  };
  try {
    const prices = await fetchPetrolimexPrices();
    assert.equal(requestedUrl.hostname, 'portals.petrolimex.com.vn');
    assert.ok(requestedUrl.searchParams.get('x-request'));
    assert.deepEqual(prices, {
      priceDate: '2026-09-17',
      source: 'Petrolimex · Giá bán lẻ trực tuyến',
      items: [{ name: 'Xăng E10 RON 95-III', region1: 20_220, region2: 20_620 }],
    });
  } finally {
    global.fetch = originalFetch;
  }
});
