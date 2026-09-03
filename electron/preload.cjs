'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Cầu nối tối thiểu. Toàn bộ dữ liệu nghiệp vụ đi qua HTTP tới server nội bộ,
 * giống hệt máy trạm — nên ở đây không có hàm nào chạm vào cơ sở dữ liệu.
 */
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    isDesktop: true,
    /** Danh sách địa chỉ LAN để đọc cho nhân viên nhập vào trình duyệt. */
    addresses: () => ipcRenderer.invoke('app:addresses'),
  }),
);
