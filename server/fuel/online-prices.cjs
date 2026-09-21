'use strict';

const PETROLIMEX_PRICES_API = 'https://portals.petrolimex.com.vn/~apis/portals/cms.item/search';
const PETROLIMEX_FILTER = {
  FilterBy: {
    And: [
      { SystemID: { Equals: '6783dc1271ff449e95b74a9520964169' } },
      { RepositoryID: { Equals: 'a95451e23b474fe5886bfb7cf843f53c' } },
      { RepositoryEntityID: { Equals: '3801378fe1e045b1afa10de7c5776124' } },
      { Status: { Equals: 'Published' } },
    ],
  },
  SortBy: { LastModified: 'Descending' },
  Pagination: { TotalRecords: -1, TotalPages: 0, PageSize: 0, PageNumber: 0 },
};

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function validPrice(value) {
  const price = Number(value);
  return Number.isSafeInteger(price) && price > 0 ? price : null;
}

async function fetchPetrolimexPrices() {
  const url = new URL(PETROLIMEX_PRICES_API);
  url.searchParams.set('x-request', base64UrlJson(PETROLIMEX_FILTER));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Petrolimex trả về HTTP ${response.status}.`);
  const payload = await response.json();
  const items = (Array.isArray(payload?.Objects) ? payload.Objects : [])
    .map((item) => ({
      name: String(item?.Title ?? '').trim(),
      region1: validPrice(item?.Zone1Price),
      region2: validPrice(item?.Zone2Price),
    }))
    .filter((item) => item.name && item.region1 && item.region2);
  if (!items.length) throw new Error('Petrolimex không trả về bảng giá hợp lệ.');

  const date = String(payload?.Objects?.[0]?.LastModified ?? '').slice(0, 10);
  return {
    priceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    source: 'Petrolimex · Giá bán lẻ trực tuyến',
    items,
  };
}

module.exports = { fetchPetrolimexPrices };
