'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  session,
  shell,
  nativeImage,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../server/index.cjs');
const { installFileLogging } = require('../server/file-log.cjs');
const { COMPANY_PROFILES } = require('../server/company-profiles.cjs');
const { isReportPrintPopup } = require('./report-window.cjs');
const { companyFromArgv, defaultCompanyIndex, loginItem, startsHidden } = require('./startup.cjs');

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const MACHINE_CONFIG_FILE = 'machine-mode.json';
const LAST_COMPANY_FILE = 'last-company.json';
const USER_DATA_DIRECTORY = 'Quản lý cước phí';
let backend;
let mainWindow;
let tray;
let origin = '';
let machine;
let company;
let quitting = false;
let fileLog = null;
let updateCheckStarted = false;
let backendPort;
// Windows tự mở lúc đăng nhập: chạy ngầm dưới khay, không bật cửa sổ.
const launchedHidden = startsHidden(process.argv);

// Hồ sơ Nam Hưng Việt giữ nguyên thư mục cũ. Các hồ sơ khác được tách thành
// thư mục con trước khi khởi động backend, để dữ liệu và cấu hình máy chủ
// không thể lẫn nhau.
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIRECTORY));
app.enableSandbox();

function baseDataDirectory() {
  return path.join(app.getPath('appData'), USER_DATA_DIRECTORY);
}

function companyDataDirectory(profile) {
  const base = baseDataDirectory();
  return profile.usesLegacyDataDirectory ? base : path.join(base, 'profiles', profile.id);
}

function lastCompanyPath() {
  return path.join(baseDataDirectory(), LAST_COMPANY_FILE);
}

function readLastCompanyId() {
  try {
    return JSON.parse(readFileSync(lastCompanyPath(), 'utf8'))?.id ?? null;
  } catch {
    return null;
  }
}

function saveLastCompanyId(id) {
  try {
    mkdirSync(baseDataDirectory(), { recursive: true });
    writeFileSync(lastCompanyPath(), `${JSON.stringify({ id }, null, 2)}\n`, 'utf8');
  } catch (error) {
    // Chỉ ảnh hưởng nút chọn sẵn lần sau, không chặn việc mở ứng dụng.
    console.warn('Không lưu được công ty mở gần nhất:', error.message);
  }
}

async function chooseCompany() {
  const selected = await dialog.showMessageBox({
    type: 'question',
    title: 'Chọn công ty',
    message: 'Bạn muốn mở dữ liệu của công ty nào?',
    detail: 'Mỗi công ty có máy chủ, tài khoản và dữ liệu hoàn toàn riêng.',
    buttons: [...COMPANY_PROFILES.map((profile) => profile.name), 'Thoát'],
    defaultId: defaultCompanyIndex(COMPANY_PROFILES, readLastCompanyId()),
    cancelId: COMPANY_PROFILES.length,
    noLink: true,
  });
  return COMPANY_PROFILES[selected.response] ?? null;
}

// Tự khởi động chỉ có ở bản đã cài: bản chạy thử từ mã nguồn không được ghi
// đường dẫn electron.exe tạm thời vào danh sách khởi động của Windows.
const canAutoStart = () => app.isPackaged && process.platform === 'win32';

function autoStartEnabled() {
  if (!canAutoStart()) return false;
  const { name, args } = loginItem(company);
  const settings = app.getLoginItemSettings({ path: process.execPath, args });
  return (
    settings.launchItems?.some((item) => item.name === name && item.enabled !== false) ??
    settings.openAtLogin
  );
}

function setAutoStart(enabled) {
  const { name, args } = loginItem(company);
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args, name });
    console.log(`${enabled ? 'Bật' : 'Tắt'} khởi động cùng Windows cho ${company.name}.`);
  } catch (error) {
    dialog.showErrorBox('Không đổi được thiết lập', String(error?.message ?? error));
  }
  // Dựng lại menu để dấu tick phản ánh đúng trạng thái thật trong Windows.
  createTray(backendPort);
}

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
  try {
    url = new URL(String(value).trim());
  } catch {
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
    if (value?.role === 'client')
      return { role: 'client', serverUrl: normalizeServerUrl(value.serverUrl) };
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

// Mở "Đổi máy chủ…" lần nữa khi hộp thiết lập đang mở thì dùng lại hộp đó,
// không đăng ký trùng IPC handler (Electron sẽ ném lỗi).
let pendingClientSetup = null;
let clientSetupWindow = null;

function askClientServer() {
  if (pendingClientSetup) {
    clientSetupWindow?.focus();
    return pendingClientSetup;
  }
  pendingClientSetup = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler('machine:configure-client');
      pendingClientSetup = null;
      clientSetupWindow = null;
      resolve(value);
    };
    const setupWindow = new BrowserWindow({
      width: 460,
      height: 310,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      icon: ICON,
      webPreferences: {
        preload: path.join(__dirname, 'setup-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    clientSetupWindow = setupWindow;
    ipcMain.handle('machine:configure-client', (event, rawUrl) => {
      if (event.sender.id !== setupWindow.webContents.id)
        return { ok: false, error: 'Yêu cầu thiết lập không hợp lệ.' };
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
  return pendingClientSetup;
}

async function chooseMachine() {
  const selected = await dialog.showMessageBox({
    type: 'question',
    title: 'Thiết lập máy',
    message: 'Máy này sẽ làm nhiệm vụ gì?',
    detail:
      'Máy chủ lưu SQLite và phục vụ các máy trong mạng. Máy trạm chỉ kết nối tới máy chủ, không tạo dữ liệu riêng.',
    buttons: ['Máy chủ', 'Máy trạm', 'Thoát'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (selected.response === 2) return null;
  if (selected.response === 0) return { role: 'host' };
  const serverUrl = await askClientServer();
  return serverUrl ? { role: 'client', serverUrl } : null;
}

async function startBackend() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  const dbFile = path.join(dataDir, 'cost-app.sqlite');
  backend = createApp({
    dbFile,
    staticRoot: path.join(__dirname, '..', 'dist'),
    automaticBackupDir: path.join(dataDir, 'backups'),
  });
  const address = await backend.listen(company.port, '0.0.0.0');
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

async function stopBackend() {
  if (!backend) return;
  const closing = backend;
  backend = undefined;
  await closing.close();
}

async function installDownloadedUpdate() {
  quitting = true;
  await stopBackend();
  autoUpdater.quitAndInstall(false, true);
}

function setupAutoUpdate() {
  // Chỉ kiểm tra khi ứng dụng đã được đóng gói. Môi trường phát triển không có
  // app-update.yml nên không được phép gọi máy chủ phát hành.
  if (!app.isPackaged || process.platform !== 'win32' || updateCheckStarted) return;
  updateCheckStarted = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', (error) => console.warn('Không thể kiểm tra cập nhật:', error.message));
  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Đã tải bản cập nhật',
        message: 'Bản cập nhật mới đã sẵn sàng.',
        detail:
          'Chọn “Cài đặt ngay” để đóng ứng dụng và cập nhật. Hoặc chọn “Để sau” để tiếp tục làm việc.',
        buttons: ['Cài đặt ngay', 'Để sau'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then((result) => {
        if (result.response === 0) void installDownloadedUpdate();
      });
  });
  // Chờ giao diện xuất hiện trước để không làm chậm lần mở ứng dụng đầu tiên.
  const timer = setTimeout(() => {
    void autoUpdater
      .checkForUpdates()
      .catch((error) => console.warn('Không thể kiểm tra cập nhật:', error.message));
  }, 10_000);
  timer.unref();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f4f6f8',
    show: false,
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      webviewTag: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (isReportPrintPopup(url, frameName)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1200,
          height: 850,
          autoHideMenuBar: true,
          icon: ICON,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            devTools: !app.isPackaged,
          },
        },
      };
    }
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', (printWindow) => {
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    printWindow.webContents.on('will-redirect', (event) => event.preventDefault());
  });
  // So đúng origin: startsWith để lọt http://127.0.0.1:3100@evil.com hoặc cổng 31000.
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === new URL(origin).origin;
    } catch {
      return false;
    }
  };
  const blockForeign = (event, url) => {
    if (!sameOrigin(url)) event.preventDefault();
  };
  mainWindow.webContents.on('will-navigate', blockForeign);
  mainWindow.webContents.on('will-redirect', blockForeign);
  mainWindow.webContents.on('did-fail-load', (_event, _code, description, url, isMainFrame) => {
    if (machine.role !== 'client' || !isMainFrame || !url.startsWith(origin)) return;
    dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: 'Không kết nối được máy chủ',
        message: `Không mở được ${origin}.`,
        detail: `${description}\nKiểm tra máy chủ đang bật và cùng mạng nội bộ.`,
        buttons: ['Đổi máy chủ', 'Đóng'],
        defaultId: 0,
        noLink: true,
      })
      .then((result) => {
        if (result.response === 0) void configureClient();
      });
  });
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.loadURL(origin);
  if (!launchedHidden) mainWindow.once('ready-to-show', () => mainWindow.show());
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
  tray.setToolTip(`${company.name} — ${isHost ? 'máy chủ đang chạy' : 'máy trạm đang kết nối'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở ứng dụng', click: showWindow },
      ...(isHost
        ? [
            {
              label: 'Địa chỉ cho máy nhân viên…',
              click: () =>
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Địa chỉ truy cập',
                  message: 'Nhân viên mở trình duyệt và gõ một trong các địa chỉ sau:',
                  detail: lanAddresses(port).join('\n'),
                  buttons: ['Đóng'],
                }),
            },
          ]
        : [
            { label: `Máy chủ: ${origin}`, enabled: false },
            { label: 'Đổi máy chủ…', click: () => void configureClient() },
          ]),
      ...(fileLog
        ? [{ label: 'Mở thư mục log…', click: () => void shell.openPath(fileLog.dir) }]
        : []),
      ...(isHost && canAutoStart()
        ? [
            { type: 'separator' },
            {
              label: `Khởi động cùng Windows (${company.name})`,
              type: 'checkbox',
              checked: autoStartEnabled(),
              click: (item) => setAutoStart(item.checked),
            },
          ]
        : []),
      { type: 'separator' },
      {
        label: isHost ? 'Thoát (máy nhân viên sẽ mất kết nối)' : 'Thoát',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', showWindow);
}

function announceFirstRun(port) {
  if (!backend.seeded) return;
  dialog.showMessageBoxSync({
    type: 'info',
    title: 'Tài khoản quản trị đầu tiên',
    message: 'Đây là lần chạy đầu tiên.',
    detail: `Tên đăng nhập: ${backend.seeded.username}\nMật khẩu mặc định: ${backend.seeded.password}\n\nSau khi đăng nhập, ứng dụng sẽ bắt buộc bạn đặt mật khẩu mới trước khi sử dụng.\n\nMáy nhân viên truy cập qua:\n${lanAddresses(port).join('\n')}`,
    buttons: ['Tiếp tục'],
  });
}

app.whenReady().then(async () => {
  try {
    // Mở bằng tay luôn hỏi công ty; Windows tự mở thì đã ghi sẵn công ty.
    company = companyFromArgv(process.argv, COMPANY_PROFILES) ?? (await chooseCompany());
    if (!company) return app.quit();
    const companyDataDirectoryPath = companyDataDirectory(company);
    mkdirSync(companyDataDirectoryPath, { recursive: true });
    app.setPath('userData', companyDataDirectoryPath);
    if (!app.requestSingleInstanceLock()) return app.quit();
    saveLastCompanyId(company.id);
    // Log theo từng công ty, cạnh dữ liệu của công ty đó.
    fileLog = installFileLogging(path.join(app.getPath('userData'), 'logs'));
    console.log(
      `Khởi động ${company.name} — phiên bản ${app.getVersion()}${launchedHidden ? ' (tự mở cùng Windows)' : ''}`,
    );
    machine = readMachineConfig() ?? (await chooseMachine());
    if (!machine) return app.quit();
    saveMachineConfig(machine);
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    Menu.setApplicationMenu(null);
    const port = machine.role === 'host' ? await startBackend() : undefined;
    backendPort = port;
    if (machine.role === 'client') origin = machine.serverUrl;
    if (machine.role === 'host') announceFirstRun(port);
    createTray(port);
    createWindow();
    setupAutoUpdate();
    ipcMain.handle('app:addresses', () => (machine.role === 'host' ? lanAddresses(port) : []));
  } catch (error) {
    const busy = error?.code === 'EADDRINUSE';
    dialog.showErrorBox(
      'Không khởi động được',
      busy
        ? `Cổng ${company?.port ?? ''} đang bị chương trình khác chiếm. Hãy đóng chương trình đó rồi mở lại.`
        : String(error?.message ?? error),
    );
    app.exit(1);
  }
});

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', async (event) => {
  if (!backend) return;
  event.preventDefault();
  try {
    await stopBackend();
  } finally {
    app.exit(0);
  }
});
app.on('web-contents-created', (_event, contents) =>
  contents.on('will-attach-webview', (event) => event.preventDefault()),
);
