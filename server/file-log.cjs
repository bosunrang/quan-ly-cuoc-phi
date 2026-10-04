'use strict';

/**
 * Ghi log ra file theo ngày để tra cứu khi có sự cố (nhất là khi người dùng ở
 * xa truy cập qua tunnel và không ai nhìn thấy console của máy chính).
 * Giữ nguyên hành vi in ra console; chỉ ghi thêm một bản vào file.
 */

const { createWriteStream, mkdirSync, readdirSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');
const { format } = require('node:util');

const DEFAULT_RETENTION_DAYS = 30;
// Chặn trường hợp một lỗi lặp vô hạn làm đầy ổ đĩa.
const MAX_BYTES_PER_DAY = 20 * 1024 * 1024;
const FILE_PATTERN = /^app-(\d{4}-\d{2}-\d{2})\.log$/;

function localDateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Giữ `retention` ngày gần nhất, luôn tính cả file của ngày hiện tại. */
function pruneLogs(dir, retention, currentFile) {
  const older = readdirSync(dir)
    .filter((name) => FILE_PATTERN.test(name) && name !== currentFile)
    .sort()
    .reverse();
  for (const name of older.slice(Math.max(0, retention - 1))) unlinkSync(join(dir, name));
}

function installFileLogging(
  dir,
  {
    retention = DEFAULT_RETENTION_DAYS,
    maxBytesPerDay = MAX_BYTES_PER_DAY,
    now = () => new Date(),
  } = {},
) {
  mkdirSync(dir, { recursive: true });
  const original = { log: console.log, warn: console.warn, error: console.error };
  let stream = null;
  let streamDate = '';
  let written = 0;
  let capped = false;

  const rotate = (date) => {
    stream?.end();
    streamDate = date;
    written = 0;
    capped = false;
    const fileName = `app-${date}.log`;
    stream = createWriteStream(join(dir, fileName), { flags: 'a' });
    stream.on('error', () => {});
    try {
      pruneLogs(dir, retention, fileName);
    } catch {
      // Dọn log cũ không được làm hỏng ứng dụng.
    }
  };

  const write = (level, args) => {
    try {
      const at = now();
      const date = localDateStamp(at);
      if (date !== streamDate) rotate(date);
      if (capped) return;
      const line = `${at.toISOString()} [${level}] ${format(...args)}\n`;
      written += Buffer.byteLength(line);
      if (written > maxBytesPerDay) {
        capped = true;
        stream.write(
          `${at.toISOString()} [WARN] Đã đạt giới hạn dung lượng log trong ngày; bỏ qua phần còn lại.\n`,
        );
        return;
      }
      stream.write(line);
    } catch {
      // Ghi log lỗi không được làm hỏng ứng dụng.
    }
  };

  for (const level of ['log', 'warn', 'error']) {
    console[level] = (...args) => {
      original[level](...args);
      write(level === 'log' ? 'INFO' : level.toUpperCase(), args);
    };
  }

  // "Monitor" chỉ quan sát: lỗi chưa bắt vẫn được Node/Electron xử lý như cũ
  // (Promise bị từ chối mà không ai bắt cũng đi qua đây ở chế độ mặc định).
  const onFatal = (error, origin) => write('FATAL', [origin, error]);
  process.on('uncaughtExceptionMonitor', onFatal);

  return {
    dir,
    /** Trả lại console gốc và đợi ghi xong phần log còn lại. */
    close() {
      Object.assign(console, original);
      process.off('uncaughtExceptionMonitor', onFatal);
      const closing = stream;
      stream = null;
      return new Promise((resolve) => (closing ? closing.end(resolve) : resolve()));
    },
  };
}

module.exports = { installFileLogging, pruneLogs };
