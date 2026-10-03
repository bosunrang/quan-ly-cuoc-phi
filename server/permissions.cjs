'use strict';

/**
 * Danh sách thẻ (màn hình) của ứng dụng.
 *
 * Phải khớp với PageId trong src/types.ts và navGroups trong src/app/navigation.ts.
 * Ô tick trong màn hình Cài đặt được sinh tự động từ danh sách này.
 *
 *   adminOnly: true  -> chỉ Admin, không cấp cho nhân viên được
 *   ownScope:  true  -> nhân viên chỉ thấy dữ liệu do chính mình tạo
 */
const PAGES = [
  {
    key: 'dashboard',
    label: 'Tổng quan',
    description: 'Xem nhanh tình hình cước phí và hoạt động gần đây.',
    adminOnly: false,
    ownScope: true,
  },
  {
    key: 'entries',
    label: 'Nhập chi phí gửi hàng',
    description: 'Nhập và sửa phiếu cước của chính mình.',
    adminOnly: false,
    ownScope: true,
  },
  {
    key: 'misa',
    label: 'Dữ liệu MISA',
    description: 'Nhập và đối chiếu dữ liệu từ phần mềm MISA.',
    adminOnly: true,
    ownScope: false,
  },
  {
    key: 'employees',
    label: 'Danh sách nhân viên',
    description: 'Hồ sơ nhân viên phụ trách gửi hàng.',
    adminOnly: true,
    ownScope: false,
  },
  {
    key: 'customers',
    label: 'Danh sách khách hàng',
    description: 'Danh mục khách hàng dùng chung.',
    adminOnly: true,
    ownScope: false,
  },
  {
    key: 'carriers',
    label: 'Danh sách nhà xe',
    description: 'Chành xe, địa chỉ, liên hệ và giờ xe chạy.',
    adminOnly: true,
    ownScope: false,
  },
  {
    key: 'fuel',
    label: 'Tính giá xăng',
    description: 'Quy đổi chi phí nhiên liệu theo quãng đường.',
    adminOnly: false,
    ownScope: true,
  },
  {
    key: 'reports_employee',
    label: 'Báo cáo cước gửi hàng',
    description: 'Tổng hợp cước phí giao hàng theo nhân viên và kỳ báo cáo.',
    // Có thể cấp cho máy trạm. Các route báo cáo vẫn ép nhân viên chỉ thấy
    // dữ liệu thuộc hồ sơ liên kết với tài khoản của họ.
    adminOnly: false,
    ownScope: true,
  },
  {
    key: 'reports_carrier',
    label: 'Báo cáo cước nhà xe',
    description: 'Đối chiếu giá thiết lập với cước thực tế theo nhà xe.',
    adminOnly: true,
    ownScope: false,
  },
  {
    key: 'reports_fuel_price',
    label: 'Báo cáo tiền xăng',
    description: 'Theo dõi lịch sử các kỳ tính xăng đã lưu.',
    adminOnly: true,
    ownScope: false,
  },
  {
    key: 'users',
    label: 'Người dùng',
    description: 'Tài khoản và thẻ truy cập của từng nhân viên.',
    adminOnly: true,
    ownScope: false,
  },
  {
    key: 'audit',
    label: 'Nhật ký hoạt động',
    description: 'Lịch sử thay đổi và các thao tác quan trọng.',
    adminOnly: true,
    ownScope: false,
  },
  {
    key: 'settings',
    label: 'Cài đặt',
    description: 'Cấu hình dữ liệu, sao lưu và hiển thị hệ thống.',
    adminOnly: true,
    ownScope: false,
  },
];

const PAGE_KEYS = new Set(PAGES.map((page) => page.key));

/** Các thẻ có thể cấp cho nhân viên qua màn hình Cài đặt. */
const GRANTABLE_PAGES = PAGES.filter((page) => !page.adminOnly);

function isValidPageKey(key) {
  return typeof key === 'string' && PAGE_KEYS.has(key);
}

/**
 * Thẻ mà một người dùng được mở.
 * Admin luôn có toàn bộ; nhân viên lấy theo bảng user_pages.
 */
function pagesForUser(db, user) {
  if (user.is_admin) return PAGES.map((page) => page.key);
  const rows = db
    .prepare('SELECT page_key FROM user_pages WHERE user_id = ?')
    .all(user.id);
  // Lọc lại theo registry: thẻ đã gỡ khỏi app thì không còn hiệu lực.
  return rows
    .map((row) => row.page_key)
    .filter(
      (key) => PAGE_KEYS.has(key) && !PAGES.find((p) => p.key === key).adminOnly,
    );
}

function canAccess(pages, key) {
  return pages.includes(key);
}

/**
 * Người này có được xem dữ liệu của người khác không.
 * Chỉ Admin. Nhân viên luôn bị giới hạn ở dữ liệu của chính mình.
 */
function canSeeEveryone(user) {
  return Boolean(user.is_admin);
}

module.exports = {
  PAGES,
  GRANTABLE_PAGES,
  isValidPageKey,
  pagesForUser,
  canAccess,
  canSeeEveryone,
};
