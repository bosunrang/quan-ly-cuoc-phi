'use strict';

const {
  randomBytes,
  scryptSync,
  createHash,
  timingSafeEqual,
} = require('node:crypto');

const SCRYPT_KEY_LENGTH = 64;
const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_ATTEMPT_KEYS = 2_000;

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- mật khẩu

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const attempt = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  const stored = Buffer.from(hash, 'hex');
  // Độ dài khác nhau thì timingSafeEqual ném lỗi, nên kiểm tra trước.
  if (attempt.length !== stored.length) return false;
  return timingSafeEqual(attempt, stored);
}

/** Yêu cầu tối thiểu cho mật khẩu. Trả về null nếu hợp lệ. */
function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Mật khẩu phải có ít nhất 8 ký tự.';
  }
  if (password.length > 200) return 'Mật khẩu quá dài.';
  return null;
}

// ---------------------------------------------------------------- phiên

const hashToken = (token) =>
  createHash('sha256').update(token).digest('hex');

function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    Date.now() + SESSION_HOURS * 60 * 60 * 1000,
  ).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), userId, now(), expiresAt);
  return { token, expiresAt };
}

/** Trả về user đang đăng nhập, hoặc null nếu token sai/hết hạn/tài khoản đã khóa. */
function userForToken(db, token) {
  if (!token) return null;
  const session = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(hashToken(token));
  if (!session) return null;
  if (session.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  const user = db
    .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
    .get(session.user_id);
  return user ?? null;
}

function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function destroyAllSessionsFor(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
}

// ------------------------------------------------- giới hạn số lần đăng nhập

// Bộ đếm nằm trong bộ nhớ: khởi động lại server là xóa. Ghép tài khoản với địa
// chỉ máy để một máy nhập sai không khóa tài khoản trên toàn bộ mạng nội bộ.
const attempts = new Map();

function attemptKey(username, address = '') {
  return `${String(username).trim().toLowerCase()}\n${String(address).trim() || 'unknown'}`;
}

function purgeOldAttempts(at = Date.now()) {
  for (const [key, record] of attempts) {
    if (at - record.first > LOCKOUT_MS) attempts.delete(key);
  }
  while (attempts.size >= MAX_ATTEMPT_KEYS) {
    attempts.delete(attempts.keys().next().value);
  }
}

function loginBlockedFor(username, address) {
  purgeOldAttempts();
  const key = attemptKey(username, address);
  const record = attempts.get(key);
  if (!record) return 0;
  if (Date.now() - record.first > LOCKOUT_MS) {
    attempts.delete(key);
    return 0;
  }
  if (record.count < MAX_ATTEMPTS) return 0;
  return Math.ceil((LOCKOUT_MS - (Date.now() - record.first)) / 60000);
}

function recordFailedLogin(username, address) {
  purgeOldAttempts();
  const key = attemptKey(username, address);
  const record = attempts.get(key);
  if (!record || Date.now() - record.first > LOCKOUT_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
    return;
  }
  record.count += 1;
}

function clearFailedLogins(username, address) {
  attempts.delete(attemptKey(username, address));
}

module.exports = {
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
  createSession,
  userForToken,
  destroySession,
  destroyAllSessionsFor,
  purgeExpiredSessions,
  loginBlockedFor,
  recordFailedLogin,
  clearFailedLogins,
  SESSION_HOURS,
};
