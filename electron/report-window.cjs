'use strict';

// Chỉ cửa sổ trống do nút in báo cáo tạo ra mới được mở trong Electron.
function isReportPrintPopup(url, frameName) {
  return frameName === 'report-print' && (url === 'about:blank' || url === '');
}

module.exports = { isReportPrintPopup };
