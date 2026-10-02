'use strict';

const { createReadStream, existsSync, statSync } = require('node:fs');
const { extname, join, normalize, sep } = require('node:path');

// Backup có thể chứa nhiều dòng MISA, nên cần lớn hơn các biểu mẫu thông thường.
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // read-excel-file tạo Web Worker từ Blob URL để giải nén và phân tích XLSX.
  // Chỉ mở blob: cho worker; các script thông thường vẫn bị giới hạn ở 'self'.
  "worker-src 'self' blob:",
].join('; ');

/** Lỗi có mã HTTP. Ném cái này ở route, lớp dưới tự dịch thành phản hồi. */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code ?? `HTTP_${status}`;
  }
}

const badRequest = (message) => new HttpError(400, message);
const unauthorized = (message = 'Bạn cần đăng nhập lại.') =>
  new HttpError(401, message);
const forbidden = (message = 'Bạn không có quyền thực hiện việc này.') =>
  new HttpError(403, message);
const notFound = (message = 'Không tìm thấy dữ liệu.') =>
  new HttpError(404, message);
const conflict = (message) => new HttpError(409, message, 'CONFLICT');

/** Kiểm tra ngày lịch thực, không chỉ đúng hình thức YYYY-MM-DD. */
function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Ngày hiện tại theo múi giờ của máy chủ, không quy đổi sang UTC. */
function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------- phản hồi

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message =
    error instanceof HttpError
      ? error.message
      : 'Máy chủ gặp lỗi khi xử lý yêu cầu.';
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  if (status >= 500) console.error('[loi]', error);
  sendJson(res, status, { error: message, code });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw badRequest('Dữ liệu gửi lên quá lớn.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw badRequest('Dữ liệu gửi lên không đúng định dạng.');
  }
}

// ---------------------------------------------------------------- định tuyến

function compile(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) {
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      names.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), names };
}

function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const { regex, names } = compile(pattern);
    routes.push({ method, regex, names, handler });
  };
  return {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    patch: (pattern, handler) => add('PATCH', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),
    /** Tìm route khớp. Trả về null nếu không có đường dẫn nào khớp. */
    match(method, pathname) {
      let pathExists = false;
      for (const route of routes) {
        const found = route.regex.exec(pathname);
        if (!found) continue;
        pathExists = true;
        if (route.method !== method) continue;
        const params = {};
        route.names.forEach((name, index) => {
          params[name] = decodeURIComponent(found[index + 1]);
        });
        return { handler: route.handler, params };
      }
      if (pathExists) throw new HttpError(405, 'Phương thức không được hỗ trợ.');
      return null;
    },
  };
}

// ------------------------------------------------------------- file tĩnh

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Phục vụ giao diện đã build. Đường dẫn không phải file thì trả index.html
 * để giao diện tự điều hướng. Chặn thoát ra ngoài thư mục gốc.
 */
function serveStatic(root, pathname, res) {
  const relative = normalize(decodeURIComponent(pathname)).replace(
    /^([/\\])+/,
    '',
  );
  if (relative.split(sep).includes('..')) {
    sendError(res, notFound());
    return true;
  }

  let file = join(root, relative);
  if (!existsSync(file) || !statSync(file).isFile()) {
    file = join(root, 'index.html');
    if (!existsSync(file)) return false;
  }

  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const isHtml = type.startsWith('text/html');
	const isPwaMetadata = file.endsWith('sw.js') || file.endsWith('manifest.webmanifest');
  res.writeHead(200, {
    'content-type': type,
		...SECURITY_HEADERS,
		...(isHtml ? { 'content-security-policy': CONTENT_SECURITY_POLICY } : {}),
		'cache-control': isHtml || isPwaMetadata ? 'no-cache' : 'public, max-age=3600',
		...(file.endsWith('sw.js') ? { 'service-worker-allowed': '/' } : {}),
  });
  createReadStream(file).pipe(res);
  return true;
}

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  isIsoDate,
  localIsoDate,
  sendJson,
  sendError,
  readJsonBody,
  createRouter,
  serveStatic,
};
