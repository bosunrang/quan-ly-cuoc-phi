'use strict';

const { createReadStream, existsSync, statSync } = require('node:fs');
const { extname, join, normalize, sep } = require('node:path');

// Biểu mẫu thông thường rất nhỏ. Route nhập dữ liệu hoặc khôi phục backup
// khai báo giới hạn lớn hơn của riêng nó khi đăng ký với router.
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const IMPORT_MAX_BODY_BYTES = 25 * 1024 * 1024;
// Backup JSON tăng theo số dòng MISA (khoảng 0,8 KB/dòng). Giới hạn này đủ cho
// vài trăm nghìn dòng mà vẫn nằm dưới độ dài chuỗi tối đa của V8.
const RESTORE_MAX_BODY_BYTES = 400 * 1024 * 1024;
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
const unauthorized = (message = 'Bạn cần đăng nhập lại.') => new HttpError(401, message);
const forbidden = (message = 'Bạn không có quyền thực hiện việc này.') =>
  new HttpError(403, message);
const notFound = (message = 'Không tìm thấy dữ liệu.') => new HttpError(404, message);
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

/** context: "METHOD /đường-dẫn" để log lỗi máy chủ biết thao tác nào gây ra. */
function sendError(res, error, context = '') {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : 'Máy chủ gặp lỗi khi xử lý yêu cầu.';
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  if (status >= 500) console.error('[loi]', context, error);
  sendJson(res, status, { error: message, code });
}

async function readJsonBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'Dữ liệu gửi lên quá lớn.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn.');
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
  /**
   * options.maxBodyBytes: giới hạn body riêng của route.
   * options.page: thẻ bắt buộc, được kiểm tra trước khi đọc body lớn.
   */
  const add = (method, pattern, handler, options = {}) => {
    const { regex, names } = compile(pattern);
    routes.push({ method, regex, names, handler, options });
  };
  return {
    get: (pattern, handler, options) => add('GET', pattern, handler, options),
    post: (pattern, handler, options) => add('POST', pattern, handler, options),
    patch: (pattern, handler, options) => add('PATCH', pattern, handler, options),
    delete: (pattern, handler, options) => add('DELETE', pattern, handler, options),
    /** Tìm route khớp. Trả về null nếu không có đường dẫn nào khớp. */
    match(method, pathname) {
      let pathExists = false;
      for (const route of routes) {
        const found = route.regex.exec(pathname);
        if (!found) continue;
        pathExists = true;
        if (route.method !== method) continue;
        const params = {};
        try {
          route.names.forEach((name, index) => {
            params[name] = decodeURIComponent(found[index + 1]);
          });
        } catch {
          throw badRequest('Đường dẫn không hợp lệ.');
        }
        return { handler: route.handler, params, options: route.options };
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
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendError(res, notFound());
    return true;
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
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
    'cache-control':
      isHtml || isPwaMetadata
        ? 'no-cache'
        : // Vite gắn mã băm vào tên file trong /assets, nên có thể cache lâu dài.
          relative.startsWith(`assets${sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
    ...(file.endsWith('sw.js') ? { 'service-worker-allowed': '/' } : {}),
  });
  // Lỗi đọc file (bị khóa/thay trong lúc cập nhật) không được làm sập tiến trình.
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}

module.exports = {
  IMPORT_MAX_BODY_BYTES,
  RESTORE_MAX_BODY_BYTES,
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
