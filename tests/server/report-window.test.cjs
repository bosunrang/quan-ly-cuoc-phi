'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isReportPrintPopup } = require('../../electron/report-window.cjs');

test('máy trạm chỉ mở cửa sổ trống dành cho bản in báo cáo', () => {
  assert.equal(isReportPrintPopup('about:blank', 'report-print'), true);
  assert.equal(isReportPrintPopup('', 'report-print'), true);
  assert.equal(isReportPrintPopup('about:blank', '_blank'), false);
  assert.equal(isReportPrintPopup('http://127.0.0.1:3100/', 'report-print'), false);
  assert.equal(isReportPrintPopup('https://example.com/', 'report-print'), false);
});
