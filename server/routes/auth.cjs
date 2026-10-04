'use strict';

const auth = require('../auth.cjs');
const { clientAddress, isLocalRequest } = require('../client-address.cjs');
const { writeAudit } = require('../audit.cjs');
const { pagesForUser, PAGES } = require('../permissions.cjs');
const { badRequest, unauthorized } = require('../http.cjs');

/** Hồ sơ gửi về giao diện. Không bao giờ kèm hash hay salt. */
function publicProfile(db, user) {
  const pages = pagesForUser(db, user);
  return {
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      isAdmin: Boolean(user.is_admin),
      mustChangePassword: Boolean(user.must_change_password),
    },
    pages,
    // Giao diện dựng thanh thẻ từ đây, không tự đoán nhãn.
    menu: PAGES.filter((page) => pages.includes(page.key)).map((page) => ({
      key: page.key,
      label: page.label,
    })),
  };
}

function register(router) {
  router.post('/api/login', async (c) => {
    const username = String(c.body.username ?? '')
      .trim()
      .toLowerCase();
    const password = String(c.body.password ?? '');
    const address = clientAddress(c.req);
    if (!username || !password) {
      throw badRequest('Vui lòng nhập tên đăng nhập và mật khẩu.');
    }

    const blockedMinutes = auth.loginBlockedFor(username, address);
    if (blockedMinutes > 0) {
      throw badRequest(`Sai quá nhiều lần. Vui lòng thử lại sau ${blockedMinutes} phút.`);
    }

    const user = c.db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    // Cùng một thông báo cho mọi trường hợp sai, để không lộ tài khoản nào có thật.
    const invalid = unauthorized('Tên đăng nhập hoặc mật khẩu không đúng.');
    // Mật khẩu quá dài không thể hợp lệ; chặn sớm để không tốn scrypt.
    if (password.length > 200) {
      auth.recordFailedLogin(username, address);
      throw invalid;
    }
    if (!user) {
      await auth.verifyDummyPassword(password);
      auth.recordFailedLogin(username, address);
      throw invalid;
    }
    if (!(await auth.verifyPassword(password, user.password_hash, user.password_salt))) {
      auth.recordFailedLogin(username, address);
      writeAudit(c.db, user, 'login.failed', 'user', user.id);
      throw invalid;
    }
    if (!user.is_active) {
      throw unauthorized('Tài khoản đã bị khóa. Liên hệ Admin.');
    }

    auth.clearFailedLogins(username, address);
    auth.purgeExpiredSessions(c.db);
    const session = auth.createSession(c.db, user.id);
    writeAudit(c.db, user, 'login', 'user', user.id);

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      ...publicProfile(c.db, user),
    };
  });

  // Chỉ máy đang chạy phần mềm mới được dùng mã khôi phục; máy trong LAN
  // không thể đổi mật khẩu quản trị viên qua endpoint này.
  router.post('/api/recover-admin', async (c) => {
    // Qua Cloudflare Tunnel yêu cầu cũng đến từ 127.0.0.1; chỉ chấp nhận yêu
    // cầu gõ trực tiếp trên máy chính, không có dấu vết đi qua proxy.
    if (!isLocalRequest(c.req)) {
      throw unauthorized('Khôi phục chỉ thực hiện được trên máy chính.');
    }
    const username = String(c.body.username ?? '')
      .trim()
      .toLowerCase();
    const code = String(c.body.code ?? '').trim();
    const password = String(c.body.password ?? '');
    const weak = auth.checkPasswordStrength(password);
    if (weak) throw badRequest(weak);
    // Dùng chung bộ đếm sai với đăng nhập, theo khóa riêng cho việc khôi phục.
    const attemptName = `recover-admin:${username}`;
    const address = clientAddress(c.req);
    const blockedMinutes = auth.loginBlockedFor(attemptName, address);
    if (blockedMinutes > 0) {
      throw badRequest(`Sai quá nhiều lần. Vui lòng thử lại sau ${blockedMinutes} phút.`);
    }

    const recovery = c.db
      .prepare('SELECT code_hash, code_salt FROM admin_recovery_code WHERE id = 1')
      .get();
    const user = c.db
      .prepare('SELECT * FROM users WHERE username = ? AND is_admin = 1 AND is_active = 1')
      .get(username);
    if (
      !recovery ||
      !user ||
      !(await auth.verifyPassword(code, recovery.code_hash, recovery.code_salt))
    ) {
      auth.recordFailedLogin(attemptName, address);
      throw unauthorized('Mã khôi phục hoặc tên quản trị viên không đúng.');
    }
    auth.clearFailedLogins(attemptName, address);

    const { hash, salt } = await auth.hashPassword(password);
    c.db.exec('BEGIN');
    try {
      c.db
        .prepare(
          'UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?',
        )
        .run(hash, salt, new Date().toISOString(), user.id);
      auth.destroyAllSessionsFor(c.db, user.id);
      c.db.prepare('DELETE FROM admin_recovery_code WHERE id = 1').run();
      writeAudit(c.db, user, 'password.recover', 'user', user.id);
      c.db.exec('COMMIT');
    } catch (error) {
      c.db.exec('ROLLBACK');
      throw error;
    }
    return { ok: true };
  });

  router.post('/api/logout', async (c) => {
    if (c.user) writeAudit(c.db, c.user, 'logout', 'user', c.user.id);
    auth.destroySession(c.db, c.token);
    return { ok: true };
  });

  // Giao diện gọi lúc khởi động để biết phiên còn hiệu lực và được mở thẻ nào.
  router.get('/api/me', async (c) => {
    if (!c.user) throw unauthorized();
    return publicProfile(c.db, c.user);
  });

  router.post('/api/me/password', async (c) => {
    if (!c.user) throw unauthorized();
    const currentPassword = String(c.body.currentPassword ?? '');
    const newPassword = String(c.body.newPassword ?? '');

    if (!(await auth.verifyPassword(currentPassword, c.user.password_hash, c.user.password_salt))) {
      throw badRequest('Mật khẩu hiện tại không đúng.');
    }
    const weak = auth.checkPasswordStrength(newPassword);
    if (weak) throw badRequest(weak);

    const { hash, salt } = await auth.hashPassword(newPassword);
    c.db
      .prepare(
        'UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      )
      .run(hash, salt, new Date().toISOString(), c.user.id);
    writeAudit(c.db, c.user, 'password.change', 'user', c.user.id);

    // Buộc đăng nhập lại trên mọi máy sau khi đổi mật khẩu.
    auth.destroyAllSessionsFor(c.db, c.user.id);
    return { ok: true };
  });

  /** Đổi mật khẩu mặc định ngay sau lần đăng nhập đầu tiên. */
  router.post('/api/me/initial-password', async (c) => {
    if (!c.user) throw unauthorized();
    if (!c.user.must_change_password) {
      throw badRequest('Tài khoản này không cần đổi mật khẩu mặc định.');
    }
    const newPassword = String(c.body.newPassword ?? '');
    const weak = auth.checkPasswordStrength(newPassword);
    if (weak) throw badRequest(weak);
    if (await auth.verifyPassword(newPassword, c.user.password_hash, c.user.password_salt)) {
      throw badRequest('Mật khẩu mới phải khác mật khẩu được cấp.');
    }
    const { hash, salt } = await auth.hashPassword(newPassword);
    c.db
      .prepare(
        'UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      )
      .run(hash, salt, new Date().toISOString(), c.user.id);
    writeAudit(c.db, c.user, 'password.initial_change', 'user', c.user.id);
    // Phiên khác mở bằng mật khẩu mặc định (có thể của người khác trong mạng)
    // bị hủy; chỉ giữ lại phiên vừa đổi mật khẩu.
    auth.destroyOtherSessionsFor(c.db, c.user.id, c.token);
    return { ok: true };
  });
}

module.exports = { register, publicProfile };
