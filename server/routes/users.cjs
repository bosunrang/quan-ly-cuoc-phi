'use strict';

const auth = require('../auth.cjs');
const { transaction } = require('../db.cjs');
const { writeAudit } = require('../audit.cjs');
const {
  GRANTABLE_PAGES,
  isValidPageKey,
  PAGES,
} = require('../permissions.cjs');
const { badRequest, notFound } = require('../http.cjs');

const PAGE = 'users';
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

function toApi(db, row, grantedPages) {
  // Khi trả về một người dùng (sau khi thêm/sửa) chỉ cần đọc quyền của người đó.
  // Danh sách dùng dữ liệu đã đọc theo lô ở dưới để tránh N+1 truy vấn.
  const pages = grantedPages ?? db
    .prepare('SELECT page_key FROM user_pages WHERE user_id = ? ORDER BY page_key')
    .all(row.id)
    .map((r) => r.page_key);
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    isAdmin: Boolean(row.is_admin),
    isActive: Boolean(row.is_active),
    // Đang dùng mật khẩu do Admin cấp, chưa tự đặt mật khẩu riêng.
    mustChangePassword: Boolean(row.must_change_password),
    // Admin luôn có mọi thẻ nên không hiển thị ô tick cho họ.
    pages: row.is_admin ? PAGES.map((p) => p.key) : pages,
    createdAt: row.created_at,
  };
}

/** Lọc danh sách thẻ gửi lên, bỏ thẻ không tồn tại hoặc chỉ dành cho Admin. */
function sanitizePages(value) {
  if (!Array.isArray(value)) return [];
  const grantable = new Set(GRANTABLE_PAGES.map((p) => p.key));
  return [...new Set(value.filter((k) => isValidPageKey(k) && grantable.has(k)))];
}

function replacePages(db, userId, pages) {
  db.prepare('DELETE FROM user_pages WHERE user_id = ?').run(userId);
  const insert = db.prepare(
    'INSERT INTO user_pages (user_id, page_key) VALUES (?, ?)',
  );
  for (const key of pages) insert.run(userId, key);
}

function register(router) {
  // Danh sách thẻ có thể cấp — giao diện dùng để vẽ các ô tick.
  router.get('/api/pages', async (c) => {
    c.requirePage(PAGE);
    return {
      pages: GRANTABLE_PAGES.map((page) => ({
        key: page.key,
        label: page.label,
        description: page.description,
      })),
    };
  });

  router.get('/api/users', async (c) => {
    c.requirePage(PAGE);
    const rows = c.db
      .prepare('SELECT * FROM users ORDER BY is_admin DESC, full_name')
      .all();
    const pagesByUser = new Map();
    for (const page of c.db
      .prepare('SELECT user_id, page_key FROM user_pages ORDER BY user_id, page_key')
      .all()) {
      const pages = pagesByUser.get(page.user_id) ?? [];
      pages.push(page.page_key);
      pagesByUser.set(page.user_id, pages);
    }
    return {
      items: rows.map((row) => toApi(c.db, row, pagesByUser.get(row.id) ?? [])),
    };
  });

  router.post('/api/users', async (c) => {
    c.requirePage(PAGE);
    const username = String(c.body.username ?? '').trim().toLowerCase();
    const fullName = String(c.body.fullName ?? '').trim();
    const password = String(c.body.password ?? '');

    if (!USERNAME_PATTERN.test(username)) {
      throw badRequest(
        'Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang; dài 3–32 ký tự.',
      );
    }
    if (!fullName) throw badRequest('Vui lòng nhập họ tên.');
    const weak = auth.checkPasswordStrength(password);
    if (weak) throw badRequest(weak);

    const taken = c.db
      .prepare('SELECT 1 FROM users WHERE username = ?')
      .get(username);
    if (taken) throw badRequest('Tên đăng nhập này đã có người dùng.');

    const isAdmin = c.body.isAdmin === true;
    const pages = isAdmin ? [] : sanitizePages(c.body.pages);
    const { hash, salt } = auth.hashPassword(password);
    const at = new Date().toISOString();

    return transaction(c.db, () => {
      const result = c.db
        .prepare(
          // Mật khẩu do Admin đặt chỉ dùng cho lần đăng nhập đầu: người dùng
          // phải tự đặt mật khẩu riêng trước khi thao tác dữ liệu.
          `INSERT INTO users
             (username, password_hash, password_salt, full_name,
              is_admin, is_active, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        )
        .run(username, hash, salt, fullName, isAdmin ? 1 : 0, at, at);
      const id = Number(result.lastInsertRowid);
      replacePages(c.db, id, pages);
      writeAudit(c.db, c.user, 'user.create', 'user', id, { username, isAdmin, pages });
      return toApi(c.db, c.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    });
  });

  router.patch('/api/users/:id', async (c) => {
    c.requirePage(PAGE);
    const id = Number(c.params.id);
    const target = c.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw notFound('Không tìm thấy người dùng.');

    const fullName =
      c.body.fullName === undefined
        ? target.full_name
        : String(c.body.fullName).trim();
    if (!fullName) throw badRequest('Vui lòng nhập họ tên.');

    let isActive = target.is_active;
    if (c.body.isActive !== undefined) {
      isActive = c.body.isActive ? 1 : 0;
      // Không cho tự khóa chính mình, tránh mất lối vào màn hình quản trị.
      if (!isActive && target.id === c.user.id) {
        throw badRequest('Không thể khóa chính tài khoản đang đăng nhập.');
      }
    }

    return transaction(c.db, () => {
      c.db
        .prepare(
          'UPDATE users SET full_name = ?, is_active = ?, updated_at = ? WHERE id = ?',
        )
        .run(fullName, isActive, new Date().toISOString(), id);

      // Thẻ của Admin không sửa được: họ luôn có toàn bộ.
      if (c.body.pages !== undefined && !target.is_admin) {
        replacePages(c.db, id, sanitizePages(c.body.pages));
      }
      // Khóa tài khoản thì cắt luôn mọi phiên đang mở.
      if (!isActive) auth.destroyAllSessionsFor(c.db, id);

      writeAudit(c.db, c.user, 'user.update', 'user', id, {
        fullName,
        isActive: Boolean(isActive),
        pages: c.body.pages === undefined ? undefined : sanitizePages(c.body.pages),
      });
      return toApi(c.db, c.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    });
  });

  // Admin đặt lại mật khẩu hộ nhân viên khi họ quên.
  router.post('/api/users/:id/password', async (c) => {
    c.requirePage(PAGE);
    const id = Number(c.params.id);
    const target = c.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw notFound('Không tìm thấy người dùng.');

    const password = String(c.body.password ?? '');
    const weak = auth.checkPasswordStrength(password);
    if (weak) throw badRequest(weak);

    const { hash, salt } = auth.hashPassword(password);
    // Đặt lại hộ người khác thì họ phải đổi ngay ở lần đăng nhập tới, để Admin
    // không biết mật khẩu họ dùng lâu dài. Tự đặt lại cho mình thì không cần.
    const mustChange = target.id === c.user.id ? target.must_change_password : 1;
    return transaction(c.db, () => {
      c.db
        .prepare(
          'UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = ?, updated_at = ? WHERE id = ?',
        )
        .run(hash, salt, mustChange, new Date().toISOString(), id);
      auth.destroyAllSessionsFor(c.db, id);
      writeAudit(c.db, c.user, 'user.reset_password', 'user', id);
      return { ok: true };
    });
  });

  router.delete('/api/users/:id', async (c) => {
    c.requirePage(PAGE);
    const id = Number(c.params.id);
    const target = c.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw notFound('Không tìm thấy người dùng.');
    if (target.is_admin) throw badRequest('Không thể xóa tài khoản quản trị viên.');
    if (target.id === c.user.id) throw badRequest('Không thể xóa chính tài khoản đang đăng nhập.');

    const used = c.db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM entries WHERE created_by = ?) +
        (SELECT COUNT(*) FROM misa_rows WHERE imported_by = ?) +
        (SELECT COUNT(*) FROM fuel_prices WHERE created_by = ?) +
        (SELECT COUNT(*) FROM fuel_records WHERE created_by = ? OR finalized_by = ? OR voided_by = ?) AS count`,
    ).get(id, id, id, id, id, id);
    if (Number(used.count) > 0) {
      throw badRequest('Tài khoản này đã có dữ liệu nghiệp vụ. Hãy khóa tài khoản để giữ lịch sử.');
    }

    return transaction(c.db, () => {
      c.db.prepare('DELETE FROM users WHERE id = ?').run(id);
      writeAudit(c.db, c.user, 'user.delete', 'user', id, {
        username: target.username,
        fullName: target.full_name,
      });
      return { ok: true };
    });
  });
}

module.exports = { register };
