'use strict';

const http = require('node:http');
const { existsSync } = require('node:fs');

const { openDatabase, SCHEMA_VERSION } = require('./db.cjs');
const { startAutomaticBackups } = require('./automatic-backup.cjs');
const auth = require('./auth.cjs');
const { writeAudit } = require('./audit.cjs');
const { pagesForUser } = require('./permissions.cjs');
const { isLocalRequest } = require('./client-address.cjs');
const {
  createRouter,
  sendJson,
  sendError,
  readJsonBody,
  serveStatic,
  unauthorized,
  forbidden,
  notFound,
} = require('./http.cjs');

/**
 * Đường dẫn không cần đăng nhập. Mọi đường dẫn khác mặc định bị chặn,
 * nên quên khai báo quyền sẽ thành "cấm" chứ không thành "mở toang".
 */
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'POST /api/login',
  'POST /api/recover-admin',
  'POST /api/logout',
  // Nhận diện ứng dụng được dùng ở màn đăng nhập, không chứa dữ liệu nghiệp vụ.
  'GET /api/settings',
]);

/**
 * Lần chạy đầu tiên: tạo tài khoản Admin với mật khẩu ngẫu nhiên. Server nghe
 * trên toàn mạng LAN ngay từ đầu, nên không dùng mật khẩu cố định dễ đoán.
 */
function seedFirstAdmin(db) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (Number(existing.count) > 0) return null;

  const password = auth.generateReadablePassword();
  const { hash, salt } = auth.hashPasswordSync(password);
  const at = new Date().toISOString();
  db.prepare(
    `INSERT INTO users
       (username, password_hash, password_salt, full_name, is_admin, is_active, must_change_password, created_at, updated_at)
     VALUES ('admin', ?, ?, 'Quản trị viên', 1, 1, 1, ?, ?)`,
  ).run(hash, salt, at, at);
  writeAudit(db, null, 'user.seed_admin', 'user', 'admin');
  return { username: 'admin', password };
}

function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

function createApp({
  dbFile,
  staticRoot,
  allowDevLogin = false,
  automaticBackupDir = null,
}) {
  const db = openDatabase(dbFile);
  const seeded = seedFirstAdmin(db);
  let backupScheduler = null;

  const router = createRouter();
  const authRoutes = require('./routes/auth.cjs');
  authRoutes.register(router);
  require('./routes/entries.cjs').register(router);
  require('./routes/customers.cjs').register(router);
  require('./routes/carriers.cjs').register(router);
  require('./routes/employees.cjs').register(router);
  require('./routes/users.cjs').register(router);
  require('./routes/audit.cjs').register(router);
  require('./routes/dashboard.cjs').register(router);
  require('./routes/settings.cjs').register(router);
  require('./routes/misa.cjs').register(router);
  require('./routes/fuel.cjs').register(router);
  require('./routes/reports.cjs').register(router);

  // Chỉ dành cho lúc xây dựng giao diện. Bản Electron không bật tùy chọn này.
  if (allowDevLogin) {
    router.post('/api/dev-login', async (c) => {
      if (!isLocalRequest(c.req)) {
        throw forbidden('Tự động đăng nhập chỉ dùng trên máy chính.');
      }

      const user = c.db
        .prepare(
          'SELECT * FROM users WHERE is_admin = 1 AND is_active = 1 ORDER BY id LIMIT 1',
        )
        .get();
      if (!user) throw unauthorized('Chưa có tài khoản Admin hoạt động.');

      auth.purgeExpiredSessions(c.db);
      const session = auth.createSession(c.db, user.id);
      writeAudit(c.db, user, 'login.dev', 'user', user.id);
      return {
        token: session.token,
        expiresAt: session.expiresAt,
        ...authRoutes.publicProfile(c.db, user),
      };
    });
  }

  router.get('/api/health', async () => ({
    status: 'ok',
    schema: SCHEMA_VERSION,
  }));

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      if (staticRoot && existsSync(staticRoot) && serveStatic(staticRoot, pathname, res)) {
        return;
      }
      sendError(res, notFound('Chưa build giao diện. Hãy chạy: npm run build'));
      return;
    }

    const matched = router.match(req.method, pathname);
    if (!matched) throw notFound('Đường dẫn không tồn tại.');

    const token = bearerToken(req);
    const user = auth.userForToken(db, token);
    const isPublic =
      PUBLIC_ROUTES.has(`${req.method} ${pathname}`) ||
      (allowDevLogin && `${req.method} ${pathname}` === 'POST /api/dev-login');
    if (!isPublic && !user) throw unauthorized();

    const pages = user ? pagesForUser(db, user) : [];
    // Route nhận body lớn khai báo thẻ cần có, để người không đủ quyền bị chặn
    // trước khi máy chủ phải đọc hàng chục/hàng trăm MB vào bộ nhớ.
    const requiredPage = matched.options?.page;
    if (requiredPage && !(user && !user.must_change_password && pages.includes(requiredPage))) {
      throw user ? forbidden('Bạn không được cấp quyền vào mục này.') : unauthorized();
    }
    const body =
      req.method === 'GET' || req.method === 'DELETE'
        ? {}
        : await readJsonBody(req, matched.options?.maxBodyBytes);

    const context = {
      db,
      req,
      user,
      token,
      pages,
      params: matched.params,
      // Nơi lưu bản sao lưu tự động (null khi server không bật sao lưu tự động).
      backups: { dbFile, dir: automaticBackupDir },
      query: Object.fromEntries(url.searchParams),
      body,
      /** Chặn nếu người dùng không được cấp thẻ này. */
      requirePage(key) {
        if (!user) throw unauthorized();
        if (user.must_change_password) {
          throw forbidden('Vui lòng đổi mật khẩu mặc định trước khi sử dụng hệ thống.');
        }
        if (!pages.includes(key)) {
          throw forbidden('Bạn không được cấp quyền vào mục này.');
        }
      },
    };

    sendJson(res, 200, await matched.handler(context));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => sendError(res, error));
  });

  return {
    db,
    seeded,
    server,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          if (automaticBackupDir && !backupScheduler) {
            backupScheduler = startAutomaticBackups(
              db,
              dbFile,
              automaticBackupDir,
            );
          }
          resolve(server.address());
        });
      });
    },
    async close() {
      if (backupScheduler) await backupScheduler.stop();
      await new Promise((resolve) => {
        // Yêu cầu đang dở (ví dụ tải backup lớn) được 3 giây để hoàn tất, sau
        // đó ngắt hẳn, để thoát ứng dụng/cài bản cập nhật không bị treo.
        const forceClose = setTimeout(() => server.closeAllConnections(), 3000);
        forceClose.unref();
        server.close(() => {
          clearTimeout(forceClose);
          db.close();
          resolve();
        });
        server.closeIdleConnections();
      });
    },
  };
}

module.exports = { createApp };
