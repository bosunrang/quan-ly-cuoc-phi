'use strict';

/**
 * Mỗi hồ sơ là một máy chủ dữ liệu độc lập. Các công ty ở hai máy chủ khác
 * nhau có thể cùng dùng cổng 3100; chỉ hai hồ sơ chạy trên cùng máy mới cần
 * cổng khác nhau.
 */
const COMPANY_PROFILES = Object.freeze([
  {
    id: 'nam-hung-viet',
    name: 'Nam Hưng Việt',
    port: 3100,
    // Giữ nguyên thư mục đang dùng để không làm gián đoạn dữ liệu hiện có.
    usesLegacyDataDirectory: true,
  },
  { id: 'naviva-group', name: 'NAVIVA GROUP', port: 3101 },
  { id: 'tuong-khue', name: 'Tường Khuê', port: 3100 },
  { id: 'winbio', name: 'Winbio', port: 3100 },
]);

const DEFAULT_COMPANY_ID = 'nam-hung-viet';

function companyProfile(id = DEFAULT_COMPANY_ID) {
  const profile = COMPANY_PROFILES.find((item) => item.id === id);
  if (!profile) {
    throw new Error(`Không nhận diện được hồ sơ công ty: ${id}.`);
  }
  return profile;
}

function companyFromArgs(args = process.argv) {
  const option = args.find((value) => String(value).startsWith('--company='));
  return companyProfile(option ? String(option).slice('--company='.length) : undefined);
}

function databaseFileName(profile) {
  return profile.usesLegacyDataDirectory ? 'cost-app.sqlite' : `cost-app-${profile.id}.sqlite`;
}

module.exports = {
  COMPANY_PROFILES,
  DEFAULT_COMPANY_ID,
  companyFromArgs,
  companyProfile,
  databaseFileName,
};
