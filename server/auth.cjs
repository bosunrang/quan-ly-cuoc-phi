'use strict';

const {
  randomBytes,
  scrypt,
  scryptSync,
  createHash,
  timingSafeEqual,
} = require('node:crypto');
const { promisify } = require('node:util');

// scrypt bất đồng bộ chạy trên thread pool của Node: mỗi lần kiểm tra mật khẩu
// (~50 ms) không chặn các yêu cầu khác, kể cả khi bị dồn dập đăng nhập từ
// Internet qua tunnel.
const scryptAsync = promisify(scrypt);

const SCRYPT_KEY_LENGTH = 64;
const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 8;
// Một máy thử sai quá nhiều lần (với bất kỳ tên đăng nhập nào) cũng bị chặn,
// để không thể dùng hàng loạt tên rác đẩy bản ghi khóa của tài khoản thật ra.
const MAX_ATTEMPTS_PER_ADDRESS = 30;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_ATTEMPT_KEYS = 2_000;

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- mật khẩu

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)).toString('hex');
  return { hash, salt };
}

/** Chỉ dùng lúc khởi động (tạo Admin đầu tiên), khi chưa phục vụ yêu cầu nào. */
function hashPasswordSync(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return { hash, salt };
}

// Hash giả để tài khoản không tồn tại cũng tốn đúng một lần scrypt, tránh lộ
// tài khoản nào có thật qua thời gian phản hồi.
const DUMMY_SALT = randomBytes(16).toString('hex');
const DUMMY_HASH = scryptSync('dummy-password', DUMMY_SALT, SCRYPT_KEY_LENGTH).toString('hex');

async function verifyDummyPassword(password) {
  await verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
  return false;
}

/** Mật khẩu ngẫu nhiên dễ đọc (bỏ các ký tự dễ nhầm như 0/O, 1/l/I). */
function generateReadablePassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function verifyPassword(password, hash, salt) {
  const attempt = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH);
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

function destroyOtherSessionsFor(db, userId, keepToken) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(
    userId,
    keepToken ? hashToken(keepToken) : '',
  );
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

const ADDRESS_KEY_PREFIX = '*address*\n';

function addressKey(address = '') {
  return `${ADDRESS_KEY_PREFIX}${String(address).trim() || 'unknown'}`;
}

function limitFor(key) {
  return key.startsWith(ADDRESS_KEY_PREFIX) ? MAX_ATTEMPTS_PER_ADDRESS : MAX_ATTEMPTS;
}

function purgeOldAttempts(at = Date.now()) {
  for (const [key, record] of attempts) {
    if (at - record.first > LOCKOUT_MS) attempts.delete(key);
  }
  if (attempts.size < MAX_ATTEMPT_KEYS) return;
  // Hết chỗ: bỏ bản ghi chưa bị khóa trước, giữ lại bản ghi đang khóa.
  for (const [key, record] of attempts) {
    if (attempts.size < MAX_ATTEMPT_KEYS) return;
    if (record.count < limitFor(key)) attempts.delete(key);
  }
  while (attempts.size >= MAX_ATTEMPT_KEYS) {
    attempts.delete(attempts.keys().next().value);
  }
}

function blockedMinutes(key, at) {
  const record = attempts.get(key);
  if (!record) return 0;
  if (at - record.first > LOCKOUT_MS) {
    attempts.delete(key);
    return 0;
  }
  if (record.count < limitFor(key)) return 0;
  return Math.ceil((LOCKOUT_MS - (at - record.first)) / 60000);
}

function loginBlockedFor(username, address) {
  purgeOldAttempts();
  const at = Date.now();
  return Math.max(
    blockedMinutes(attemptKey(username, address), at),
    blockedMinutes(addressKey(address), at),
  );
}

function countFailure(key, at) {
  const record = attempts.get(key);
  if (!record || at - record.first > LOCKOUT_MS) {
    attempts.set(key, { count: 1, first: at });
    return;
  }
  record.count += 1;
}

function recordFailedLogin(username, address) {
  purgeOldAttempts();
  const at = Date.now();
  countFailure(attemptKey(username, address), at);
  countFailure(addressKey(address), at);
}

function clearFailedLogins(username, address) {
  attempts.delete(attemptKey(username, address));
}

module.exports = {
  hashPassword,
  hashPasswordSync,
  verifyPassword,
  verifyDummyPassword,
  generateReadablePassword,
  checkPasswordStrength,
  createSession,
  userForToken,
  destroySession,
  destroyAllSessionsFor,
  destroyOtherSessionsFor,
  purgeExpiredSessions,
  loginBlockedFor,
  recordFailedLogin,
  clearFailedLogins,
  SESSION_HOURS,
};
