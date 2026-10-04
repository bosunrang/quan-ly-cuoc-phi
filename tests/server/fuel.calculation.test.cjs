'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const {
  FUEL_TYPES,
  calculateFuelTotal,
  fuelRecordInput,
} = require('../../server/fuel/calculation.cjs');

describe('tính tiền xăng', () => {
  test('danh mục nhiên liệu có E10 và E5 để cập nhật giá', () => {
    assert.ok(FUEL_TYPES.includes('Xăng E10'));
    assert.ok(FUEL_TYPES.includes('Xăng E5 RON 92'));
  });

  test('tổng km của các chặng được ưu tiên và tổng tiền làm tròn theo đồng', () => {
    const input = fuelRecordInput({
      periodFrom: '2026-09-01',
      periodTo: '2026-09-05',
      distanceKm: 999,
      consumptionLiters: 12,
      consumptionBaseKm: 100,
      fuelPrice: 20_000,
      fuelType: 'Xăng E10',
      region: 'region1',
      vehicleType: 'motorcycle',
      legs: [
        { from: 'A', to: 'B', km: 12.5 },
        { from: 'B', to: 'C', km: 17.5 },
      ],
    });

    assert.equal(input.distanceKm, 30);
    assert.equal(input.vehicleType, 'motorcycle');
    assert.equal(calculateFuelTotal(input), 72_000);
  });

  test('cộng chi phí khác có tên vào tổng tiền xăng', () => {
    const input = fuelRecordInput({
      periodFrom: '2026-09-01',
      periodTo: '2026-09-01',
      consumptionLiters: 1,
      consumptionBaseKm: 40,
      fuelPrice: 20_000,
      legs: [{ from: 'Kho', to: 'Bệnh viện', km: 40 }],
      extraCosts: [
        { name: 'Gửi xe', amount: 10_000, legIndex: 0 },
        { name: 'Tiền ăn', amount: 25_000, legIndex: 0 },
      ],
    });

    assert.deepEqual(input.extraCosts, [
      { name: 'Gửi xe', amount: 10_000, legIndex: 0 },
      { name: 'Tiền ăn', amount: 25_000, legIndex: 0 },
    ]);
    assert.equal(calculateFuelTotal(input), 55_000);
    assert.throws(
      () => fuelRecordInput({ ...input, extraCosts: [{ name: '', amount: 1 }] }),
      /Mỗi chi phí khác cần có tên và số tiền lớn hơn 0/,
    );

    assert.throws(
      () => fuelRecordInput({ ...input, extraCosts: [{ name: 'Gửi xe', amount: 1, legIndex: 1 }] }),
      /Chặng của chi phí khác không hợp lệ/,
    );
  });

  test('chỉ nhận phương tiện đã được hệ thống hỗ trợ', () => {
    const base = {
      periodFrom: '2026-09-01',
      periodTo: '2026-09-01',
      distanceKm: 1,
      consumptionLiters: 1,
      consumptionBaseKm: 40,
      fuelPrice: 20_000,
    };
    assert.equal(fuelRecordInput({ ...base, vehicleType: 'truck' }).vehicleType, 'truck');
    assert.throws(
      () => fuelRecordInput({ ...base, vehicleType: 'bus' }),
      /Phương tiện không hợp lệ/,
    );
  });

  test('giữ nguyên địa chỉ lộ trình dài đến 500 ký tự', () => {
    const address = `CÔNG TY CỔ PHẦN NAVIVA GROUP, ${'Số 89, đường Nguyễn Thị Thập, Khu Him Lam, Phường Tân Hưng, TP Hồ Chí Minh, Việt Nam. '.repeat(3)}`;
    const input = fuelRecordInput({
      periodFrom: '2026-09-01',
      periodTo: '2026-09-01',
      consumptionLiters: 1,
      consumptionBaseKm: 100,
      fuelPrice: 20_000,
      legs: [{ from: address, to: 'Điểm đến', km: 10 }],
    });

    assert.equal(input.legs[0].from, address.trim());
  });

  test('từ chối định mức bằng 0 và khoảng ngày đảo ngược', () => {
    assert.throws(
      () => fuelRecordInput({ periodFrom: '2026-09-02', periodTo: '2026-09-01' }),
      /Khoảng ngày tính không hợp lệ/,
    );
    assert.throws(
      () =>
        fuelRecordInput({
          periodFrom: '2026-09-01',
          periodTo: '2026-09-01',
          distanceKm: 1,
          consumptionLiters: 1,
          consumptionBaseKm: 0,
          fuelPrice: 1,
        }),
      /Định mức km phải lớn hơn 0/,
    );
  });

  test('không âm thầm bỏ chặng thiếu dữ liệu hoặc vượt giới hạn', () => {
    const base = {
      periodFrom: '2026-09-01',
      periodTo: '2026-09-01',
      consumptionLiters: 1,
      consumptionBaseKm: 40,
      fuelPrice: 20_000,
    };
    assert.throws(
      () => fuelRecordInput({ ...base, legs: [{ from: 'A', to: '', km: 10 }] }),
      /Mỗi chặng cần có điểm đi, điểm đến và số km lớn hơn 0/,
    );
    assert.throws(
      () =>
        fuelRecordInput({
          ...base,
          legs: Array.from({ length: 51 }, () => ({ from: 'A', to: 'B', km: 1 })),
        }),
      /tối đa 50 chặng/,
    );
  });
});
