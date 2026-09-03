'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Cầu nối chỉ dành cho cửa sổ thiết lập máy trạm. */
contextBridge.exposeInMainWorld(
  'clientSetup',
  Object.freeze({
    saveServerUrl: (value) => ipcRenderer.invoke('machine:configure-client', value),
  }),
);
