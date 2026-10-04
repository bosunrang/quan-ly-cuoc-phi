'use strict';

/**
 * Nhận diện người gửi yêu cầu khi app có thể được truy cập qua Cloudflare
 * Tunnel. cloudflared chạy trên máy chính và chuyển mọi yêu cầu từ Internet
 * vào app qua 127.0.0.1, nên địa chỉ socket không còn phân biệt được người
 * dùng và cũng không chứng minh được yêu cầu "gõ trên máy chính".
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Có một trong các header này nghĩa là yêu cầu đã đi qua tunnel/proxy.
const PROXY_HEADERS = [
  'cf-connecting-ip',
  'cf-ray',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
  'forwarded',
];

const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

function socketAddress(req) {
  return req.socket.remoteAddress ?? '';
}

function isProxied(req) {
  return PROXY_HEADERS.some((header) => req.headers[header] !== undefined);
}

/**
 * Yêu cầu thực sự xuất phát từ máy chính (cửa sổ Electron, trình duyệt trên
 * máy chính), không phải từ Internet qua tunnel.
 */
function isLocalRequest(req) {
  return LOOPBACK.has(socketAddress(req)) && !isProxied(req);
}

/**
 * IP thật của người dùng để giới hạn số lần đăng nhập sai. Chỉ tin header của
 * proxy khi yêu cầu đến từ chính máy này (cloudflared chạy cục bộ); máy khác
 * trong mạng LAN không thể giả IP bằng cách tự gửi header.
 * Cloudflare luôn ghi đè CF-Connecting-IP bằng IP thật của người truy cập.
 */
function clientAddress(req) {
  const socket = socketAddress(req) || 'unknown';
  if (!LOOPBACK.has(socket)) return socket;
  const cloudflare = String(req.headers['cf-connecting-ip'] ?? '').trim();
  if (IP_PATTERN.test(cloudflare)) return cloudflare;
  // Proxy khác: mục cuối của X-Forwarded-For do proxy gần nhất thêm vào.
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => IP_PATTERN.test(item));
  if (forwarded.length) return forwarded[forwarded.length - 1];
  return socket;
}

module.exports = { clientAddress, isLocalRequest };
