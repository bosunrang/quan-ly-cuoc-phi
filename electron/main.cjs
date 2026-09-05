'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, session, shell, nativeImage } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../server/index.cjs');

const DEFAULT_PORT = 3100;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const MACHINE_CONFIG_FILE = 'machine-mode.json';
const USER_DATA_DIRECTORY = 'Quản lý cước phí';
let backend;
let mainWindow;
let tray;
let origin = '';
let machine;
let quitting = false;

// Cố định tên thư mục dữ liệu theo tên sản phẩm, không phụ thuộc tên package npm.
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIRECTORY));
app.enableSandbox();

function lanAddresses(port) {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(`http://${net.address}:${port}`);
    }
  }
  addresses.push(`http://${os.hostname()}:${port}`);
  return addresses;
}

function configPath() {
  return path.join(app.getPath('userData'), MACHINE_CONFIG_FILE);
}

function normalizeServerUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch {
    throw new Error('Địa chỉ máy chủ chưa đúng. Ví dụ: http://192.168.1.153:3100');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Địa chỉ máy chủ phải là http:// hoặc https://, không kèm tài khoản.');
  }
  return url.origin;
}

function readMachineConfig() {
  try {
    const value = JSON.parse(readFileSync(configPath(), 'utf8'));
    if (value?.role === 'host') return { role: 'host' };
    if (value?.role === 'client') return { role: 'client', serverUrl: normalizeServerUrl(value.serverUrl) };
  } catch {
    // Chưa có cấu hình hoặc tệp cũ không hợp lệ: hỏi lại người dùng.
  }
  return null;
}

function saveMachineConfig(value) {
  mkdirSync(path.dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function clientSetupHtml() {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Kết nối máy chủ</title><style>body{margin:0;background:#f4f6f8;color:#172b3a;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}main{padding:24px}h1{margin:0;font-size:20px}p{color:#60758a;line-height:1.5}label{display:grid;gap:7px;font-weight:700}input{height:40px;padding:0 11px;border:1px solid #bdcbd6;border-radius:7px;font:inherit}input:focus{border-color:#008d95;outline:2px solid #d9f3f3}button{margin-top:18px;width:100%;height:40px;border:0;border-radius:7px;background:#087f87;color:white;font:700 14px inherit;cursor:pointer}.error{min-height:20px;margin:8px 0 0;color:#b23a33;font-size:13px}</style></head><body><main><h1>Kết nối máy chủ</h1><p>Máy trạm không lưu SQLite. Nhập địa chỉ của máy chủ trong mạng nội bộ.</p><form id="form"><label>Địa chỉ máy chủ<input id="url" value="http://192.168.1.153:3100" autocomplete="off" autofocus></label><p class="error" id="error"></p><button>Lưu và kết nối</button></form></main><script>const form=document.querySelector('#form');const input=document.querySelector('#url');const error=document.querySelector('#error');form.addEventListener('submit',async event=>{event.preventDefault();const result=await window.clientSetup.saveServerUrl(input.value);if(!result.ok)error.textContent=result.error;});</script></body></html>`;
}

function askClientServer() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler('machine:configure-client');
      resolve(value);
    };
    const setupWindow = new BrowserWindow({
      width: 460, height: 310, resizable: false, minimizable: false, maximizable: false,
      autoHideMenuBar: true, icon: ICON,
      webPreferences: {
        preload: path.join(__dirname, 'setup-preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true,
      },
    });
    ipcMain.handle('machine:configure-client', (event, rawUrl) => {
      if (event.sender.id !== setupWindow.webContents.id) return { ok: false, error: 'Yêu cầu thiết lập không hợp lệ.' };
      try {
        const serverUrl = normalizeServerUrl(rawUrl);
        finish(serverUrl);
        setupWindow.close();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
    setupWindow.on('closed', () => finish(null));
    setupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(clientSetupHtml())}`);
  });
}

async function chooseMachine() {
  const selected = await dialog.showMessageBox({
    type: 'question', title: 'Thiết lập máy', message: 'Máy này sẽ làm nhiệm vụ gì?',
    detail: 'Máy chủ lưu SQLite và phục vụ các máy trong mạng. Máy trạm chỉ kết nối tới máy chủ, không tạo dữ liệu riêng.',
    buttons: ['Máy chủ', 'Máy trạm', 'Thoát'], defaultId: 0, cancelId: 2, noLink: true,
  });
  if (selected.response === 2) return null;
  if (selected.response === 0) return { role: 'host' };
  const serverUrl = await askClientServer();
  return serverUrl ? { role: 'client', serverUrl } : null;
}

async function startBackend() {
  backend = createApp({
    dbFile: path.join(app.getPath('userData'), 'data', 'cost-app.sqlite'),
    staticRoot: path.join(__dirname, '..', 'dist'),
  });
  const address = await backend.listen(DEFAULT_PORT, '0.0.0.0');
  origin = `http://127.0.0.1:${address.port}`;
  return address.port;
}

async function configureClient() {
  const serverUrl = await askClientServer();
  if (!serverUrl) return false;
  machine = { role: 'client', serverUrl };
  origin = serverUrl;
  saveMachineConfig(machine);
  if (mainWindow) mainWindow.loadURL(origin);
  createTray();
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, backgroundColor: '#f4f6f8',
    show: false, autoHideMenuBar: true, icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false, devTools: !app.isPackaged, webviewTag: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  const blockForeign = (event, url) => { if (!url.startsWith(origin)) event.preventDefault(); };
  mainWindow.webContents.on('will-navigate', blockForeign);
  mainWindow.webContents.on('will-redirect', blockForeign);
  mainWindow.webContents.on('did-fail-load', (_event, _code, description, url, isMainFrame) => {
    if (machine.role !== 'client' || !isMainFrame || !url.startsWith(origin)) return;
    dialog.showMessageBox(mainWindow, {
      type: 'error', title: 'Không kết nối được máy chủ', message: `Không mở được ${origin}.`,
      detail: `${description}\nKiểm tra máy chủ đang bật và cùng mạng nội bộ.`,
      buttons: ['Đổi máy chủ', 'Đóng'], defaultId: 0, noLink: true,
    }).then((result) => { if (result.response === 0) void configureClient(); });
  });
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.loadURL(origin);
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function showWindow() {
  if (!mainWindow) return createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(port) {
  if (tray) tray.destroy();
  const image = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  const isHost = machine.role === 'host';
  tray.setToolTip(`Quản lý cước phí — ${isHost ? 'máy chủ đang chạy' : 'máy trạm đang kết nối'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở ứng dụng', click: showWindow },
    ...(isHost ? [{
      label: 'Địa chỉ cho máy nhân viên…',
      click: () => dialog.showMessageBox({ type: 'info', title: 'Địa chỉ truy cập', message: 'Nhân viên mở trình duyệt và gõ một trong các địa chỉ sau:', detail: lanAddresses(port).join('\n'), buttons: ['Đóng'] }),
    }] : [
      { label: `Máy chủ: ${origin}`, enabled: false },
      { label: 'Đổi máy chủ…', click: () => void configureClient() },
    ]),
    { type: 'separator' },
    { label: isHost ? 'Thoát (máy nhân viên sẽ mất kết nối)' : 'Thoát', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showWindow);
}

function announceFirstRun(port) {
  if (!backend.seeded) return;
  dialog.showMessageBoxSync({
    type: 'info', title: 'Tài khoản quản trị đầu tiên', message: 'Đây là lần chạy đầu tiên.',
    detail: `Tên đăng nhập: ${backend.seeded.username}\nMật khẩu mặc định: ${backend.seeded.password}\n\nSau khi đăng nhập, ứng dụng sẽ bắt buộc bạn đặt mật khẩu mới trước khi sử dụng.\n\nMáy nhân viên truy cập qua:\n${lanAddresses(port).join('\n')}`,
    buttons: ['Tiếp tục'],
  });
}

app.whenReady().then(async () => {
  try {
    machine = readMachineConfig() ?? await chooseMachine();
    if (!machine) return app.quit();
    saveMachineConfig(machine);
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    Menu.setApplicationMenu(null);
    const port = machine.role === 'host' ? await startBackend() : undefined;
    if (machine.role === 'client') origin = machine.serverUrl;
    if (machine.role === 'host') announceFirstRun(port);
    createTray(port);
    createWindow();
    ipcMain.handle('app:addresses', () => machine.role === 'host' ? lanAddresses(port) : []);
  } catch (error) {
    const busy = error?.code === 'EADDRINUSE';
    dialog.showErrorBox('Không khởi động được', busy ? `Cổng ${DEFAULT_PORT} đang bị chương trình khác chiếm. Hãy đóng chương trình đó rồi mở lại.` : String(error?.message ?? error));
    app.exit(1);
  }
});

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', async (event) => {
  if (!backend) return;
  event.preventDefault();
  const closing = backend;
  backend = undefined;
  await closing.close();
  app.exit(0);
});
app.on('web-contents-created', (_event, contents) => contents.on('will-attach-webview', (event) => event.preventDefault()));

if (!app.requestSingleInstanceLock()) app.exit(0);
