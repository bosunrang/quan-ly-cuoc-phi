'use strict';

const { badRequest, isIsoDate } = require('../http.cjs');

const FUEL_TYPES = [
  'Xăng E10',
  'Xăng RON 95-III',
  'Xăng E5 RON 92',
  'Dầu Diesel 0.05S',
];
const FUEL_REGIONS = new Set(['region1', 'region2']);
const MAX_ROUTE_LEGS = 50;

const cleanText = (value, max = 100) => String(value ?? '').trim().slice(0, max);

function nonNegativeNumber(value, field, integer = false) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (integer && !Number.isInteger(result))) {
    throw badRequest(`${field} không hợp lệ.`);
  }
  return result;
}

function fuelPriceInput(body) {
  const effectiveDate = cleanText(body.effectiveDate, 10);
  if (!isIsoDate(effectiveDate)) throw badRequest('Ngày hiệu lực không hợp lệ.');

  const fuelType = cleanText(body.fuelType);
  if (!fuelType) throw badRequest('Vui lòng chọn loại nhiên liệu.');

  const region = cleanText(body.region);
  if (!FUEL_REGIONS.has(region)) throw badRequest('Khu vực giá không hợp lệ.');

  return {
    effectiveDate,
    fuelType,
    region,
    price: nonNegativeNumber(body.price, 'Giá xăng', true),
    source: cleanText(body.source, 150) || 'Nhập tay',
  };
}

function fuelRecordInput(body) {
  const periodFrom = cleanText(body.periodFrom ?? body.entryDate, 10);
  const periodTo = cleanText(body.periodTo ?? body.entryDate, 10);
  if (!isIsoDate(periodFrom) || !isIsoDate(periodTo) || periodFrom > periodTo) {
    throw badRequest('Khoảng ngày tính không hợp lệ.');
  }

  const consumptionLiters = nonNegativeNumber(body.consumptionLiters, 'Mức tiêu hao');
  const consumptionBaseKm = nonNegativeNumber(body.consumptionBaseKm, 'Định mức km');
  if (!consumptionBaseKm) throw badRequest('Định mức km phải lớn hơn 0.');

  const legs = Array.isArray(body.legs)
    ? body.legs
      .slice(0, MAX_ROUTE_LEGS)
      .map((leg) => ({
        from: cleanText(leg?.from),
        to: cleanText(leg?.to),
        km: nonNegativeNumber(leg?.km, 'Quãng đường'),
      }))
      .filter((leg) => leg.from && leg.to && leg.km > 0)
    : [];
  const distanceKm = legs.length
    ? legs.reduce((sum, leg) => sum + leg.km, 0)
    : nonNegativeNumber(body.distanceKm, 'Quãng đường');
  if (!distanceKm) throw badRequest('Vui lòng nhập quãng đường.');

  const region = cleanText(body.region);
  return {
    periodFrom,
    periodTo,
    consumptionLiters,
    consumptionBaseKm,
    legs,
    distanceKm,
    fuelPrice: nonNegativeNumber(body.fuelPrice, 'Giá xăng', true),
    fuelType: cleanText(body.fuelType) || FUEL_TYPES[0],
    region: FUEL_REGIONS.has(region) ? region : 'region1',
  };
}

function calculateFuelTotal(input) {
  return Math.round(
    (input.distanceKm * input.consumptionLiters * input.fuelPrice) /
      input.consumptionBaseKm,
  );
}

function toFuelPrice(row) {
  return {
    id: row.id,
    effectiveDate: row.effective_date,
    fuelType: row.fuel_type,
    region: row.region,
    price: row.price,
    source: row.source,
  };
}

module.exports = {
  FUEL_TYPES,
  cleanText,
  fuelPriceInput,
  fuelRecordInput,
  calculateFuelTotal,
  toFuelPrice,
};
