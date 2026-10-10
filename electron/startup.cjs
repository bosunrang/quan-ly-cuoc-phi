'use strict';

/**
 * Quy tắc khởi động không phụ thuộc Electron, tách riêng để kiểm thử.
 *
 * Mở bằng tay luôn hỏi chọn công ty (máy chung chạy hai công ty). Windows tự
 * mở lúc đăng nhập thì truyền --company=<id> nên vào thẳng đúng công ty, nằm
 * dưới khay, không chờ ai bấm.
 */

const COMPANY_ARG = '--company=';
const HIDDEN_ARG = '--hidden';

/** Công ty ghi trong tham số dòng lệnh; null nếu không có hoặc không nhận ra. */
function companyFromArgv(argv, profiles) {
  const option = argv.find((value) => String(value).startsWith(COMPANY_ARG));
  if (!option) return null;
  const id = String(option).slice(COMPANY_ARG.length);
  return profiles.find((profile) => profile.id === id) ?? null;
}

function startsHidden(argv) {
  return argv.includes(HIDDEN_ARG);
}

/** Mỗi công ty một mục riêng trong danh sách khởi động của Windows. */
function loginItem(profile) {
  return {
    name: `QuanLyCuocPhi-${profile.id}`,
    args: [`${COMPANY_ARG}${profile.id}`, HIDDEN_ARG],
  };
}

/**
 * Nút được chọn sẵn trong hộp chọn công ty: công ty mở lần trước trên máy này.
 * Máy chỉ chạy Tường Khuê hoặc Winbio bấm Enter vẫn vào đúng công ty, không mở
 * nhầm dữ liệu trống của công ty khác trên cùng cổng.
 */
function defaultCompanyIndex(profiles, lastCompanyId) {
  const index = profiles.findIndex((profile) => profile.id === lastCompanyId);
  return index < 0 ? 0 : index;
}

module.exports = { companyFromArgv, startsHidden, loginItem, defaultCompanyIndex };
