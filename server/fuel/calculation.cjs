'use strict';

const { badRequest, isIsoDate } = require('../http.cjs');

const FUEL_TYPES = ['Xăng E10', 'Xăng RON 95-III', 'Xăng E5 RON 92', 'Dầu Diesel 0.05S'];
const FUEL_REGIONS = new Set(['region1', 'region2']);
const VEHICLE_TYPES = new Set(['motorcycle', 'truck']);
const MAX_ROUTE_LEGS = 50;
const MAX_EXTRA_COSTS = 20;

const cleanText = (value, max = 100) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

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

function fuelConsumptionInput(body) {
  const vehicleType = cleanText(body.vehicleType, 20);
  if (!VEHICLE_TYPES.has(vehicleType)) throw badRequest('Phương tiện không hợp lệ.');

  const consumptionLiters = nonNegativeNumber(body.consumptionLiters, 'Mức tiêu hao');
  const consumptionBaseKm = nonNegativeNumber(body.consumptionBaseKm, 'Định mức km');
  if (!consumptionLiters || !consumptionBaseKm) {
    throw badRequest('Mức tiêu hao và định mức km phải lớn hơn 0.');
  }
  return { vehicleType, consumptionLiters, consumptionBaseKm };
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

  const rawLegs = Array.isArray(body.legs) ? body.legs : [];
  if (rawLegs.length > MAX_ROUTE_LEGS) {
    throw badRequest(`Lộ trình chỉ hỗ trợ tối đa ${MAX_ROUTE_LEGS} chặng.`);
  }
  const legs = rawLegs.map((leg) => ({
    from: cleanText(leg?.from, 500),
    to: cleanText(leg?.to, 500),
    km: nonNegativeNumber(leg?.km, 'Quãng đường'),
  }));
  if (legs.some((leg) => !leg.from || !leg.to || leg.km <= 0)) {
    throw badRequest('Mỗi chặng cần có điểm đi, điểm đến và số km lớn hơn 0.');
  }
  const distanceKm = legs.length
    ? legs.reduce((sum, leg) => sum + leg.km, 0)
    : nonNegativeNumber(body.distanceKm, 'Quãng đường');
  if (!distanceKm) throw badRequest('Vui lòng nhập quãng đường.');

  const rawExtraCosts = Array.isArray(body.extraCosts) ? body.extraCosts : [];
  if (rawExtraCosts.length > MAX_EXTRA_COSTS) {
    throw badRequest(`Chỉ hỗ trợ tối đa ${MAX_EXTRA_COSTS} chi phí khác.`);
  }
  const extraCosts = rawExtraCosts.map((item) => {
    const name = cleanText(item?.name, 200);
    const amount = nonNegativeNumber(item?.amount, 'Số tiền chi phí khác', true);
    const legIndex = Number(item?.legIndex);
    if (!name || amount <= 0) {
      throw badRequest('Mỗi chi phí khác cần có tên và số tiền lớn hơn 0.');
    }
    if (
      item?.legIndex !== undefined &&
      (!Number.isInteger(legIndex) || legIndex < 0 || legIndex >= legs.length)
    ) {
      throw badRequest('Chặng của chi phí khác không hợp lệ.');
    }
    return item?.legIndex === undefined ? { name, amount } : { name, amount, legIndex };
  });

  const region = cleanText(body.region);
  const vehicleType = cleanText(body.vehicleType, 20);
  if (vehicleType && !VEHICLE_TYPES.has(vehicleType)) {
    throw badRequest('Phương tiện không hợp lệ.');
  }
  return {
    periodFrom,
    periodTo,
    consumptionLiters,
    consumptionBaseKm,
    legs,
    distanceKm,
    extraCosts,
    fuelPrice: nonNegativeNumber(body.fuelPrice, 'Giá xăng', true),
    fuelType: cleanText(body.fuelType) || FUEL_TYPES[0],
    region: FUEL_REGIONS.has(region) ? region : 'region1',
    vehicleType,
  };
}

function calculateFuelTotal(input) {
  const fuelFee = Math.round(
    (input.distanceKm * input.consumptionLiters * input.fuelPrice) / input.consumptionBaseKm,
  );
  return fuelFee + (input.extraCosts ?? []).reduce((sum, item) => sum + item.amount, 0);
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
  fuelConsumptionInput,
  fuelRecordInput,
  calculateFuelTotal,
  toFuelPrice,
};
