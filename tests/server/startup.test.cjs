'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { COMPANY_PROFILES } = require('../../server/company-profiles.cjs');
const {
  companyFromArgv,
  defaultCompanyIndex,
  loginItem,
  startsHidden,
} = require('../../electron/startup.cjs');

test('Windows tự mở vào thẳng đúng công ty, mở tay thì vẫn hỏi', () => {
  const exe = 'C:\\Program Files\\Quan Ly Cuoc Phi\\Quản lý cước phí.exe';
  assert.equal(companyFromArgv([exe], COMPANY_PROFILES), null);
  assert.equal(companyFromArgv([exe, '--force-run'], COMPANY_PROFILES), null);
  assert.equal(companyFromArgv([exe, '--company=khong-co'], COMPANY_PROFILES), null);
  assert.equal(
    companyFromArgv([exe, '--company=naviva-group', '--hidden'], COMPANY_PROFILES).name,
    'NAVIVA GROUP',
  );
  assert.equal(startsHidden([exe, '--company=naviva-group', '--hidden']), true);
  assert.equal(startsHidden([exe]), false);
});

test('mỗi công ty trên máy chung có mục khởi động riêng, tự mở lại đúng công ty đó', () => {
  const items = COMPANY_PROFILES.map(loginItem);
  assert.equal(new Set(items.map((item) => item.name)).size, COMPANY_PROFILES.length);
  for (const [index, item] of items.entries()) {
    const profile = COMPANY_PROFILES[index];
    assert.equal(companyFromArgv(['app.exe', ...item.args], COMPANY_PROFILES), profile);
    assert.equal(startsHidden(item.args), true);
  }
});

test('hộp chọn công ty chọn sẵn công ty mở lần trước trên máy này', () => {
  assert.equal(
    COMPANY_PROFILES[defaultCompanyIndex(COMPANY_PROFILES, 'tuong-khue')].name,
    'Tường Khuê',
  );
  assert.equal(COMPANY_PROFILES[defaultCompanyIndex(COMPANY_PROFILES, 'winbio')].name, 'Winbio');
  // Chưa từng mở hoặc tệp hỏng: giữ mặc định cũ.
  assert.equal(defaultCompanyIndex(COMPANY_PROFILES, null), 0);
  assert.equal(defaultCompanyIndex(COMPANY_PROFILES, 'da-bi-xoa'), 0);
});
