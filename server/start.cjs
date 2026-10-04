'use strict';

/**
 * Chạy server độc lập, không cần Electron:
 *   node server/start.cjs
 *
 * Dùng khi phát triển, hoặc sau này nếu muốn tách server ra một máy riêng.
 */

const { dirname, join } = require('node:path');
const { createApp } = require('./index.cjs');
const { installFileLogging } = require('./file-log.cjs');
const { companyFromArgs, databaseFileName } = require('./company-profiles.cjs');

const COMPANY = companyFromArgs();
const PORT = Number(process.env.PORT) || COMPANY.port;
const API_ONLY = process.argv.includes('--api-only');
const LOOPBACK_ONLY = process.argv.includes('--loopback');
const HOST = LOOPBACK_ONLY ? '127.0.0.1' : process.env.HOST || '0.0.0.0';
const ROOT = join(__dirname, '..');
// Tự đăng nhập chỉ được bật bằng lệnh phát triển tường minh. Không đọc biến môi
// trường để tránh một cấu hình cũ vô tình làm server vận hành mất xác thực.
const ALLOW_DEV_LOGIN = process.argv.includes('--dev-bypass-login');

async function main() {
  const dbFile = process.env.DB_FILE || join(ROOT, 'data', databaseFileName(COMPANY));
  installFileLogging(join(dirname(dbFile), 'logs'));
  const app = createApp({
    dbFile,
    staticRoot: API_ONLY ? null : join(ROOT, 'dist'),
    allowDevLogin: ALLOW_DEV_LOGIN,
    automaticBackupDir: join(dirname(dbFile), 'backups'),
  });

  await app.listen(PORT, HOST);
  console.log(`${COMPANY.name}: server đang chạy tại http://localhost:${PORT}`);
  if (API_ONLY) console.log('Chế độ API nội bộ: giao diện chỉ chạy qua Vite.');

  if (ALLOW_DEV_LOGIN) {
    console.log('Chế độ phát triển: tự động đăng nhập bằng tài khoản Admin.');
  }

  if (app.seeded) {
    // In thẳng ra màn hình, không qua console: mật khẩu ban đầu không được
    // nằm lại trong file log.
    process.stdout.write(
      [
        '',
        '  ===== TÀI KHOẢN ADMIN ĐẦU TIÊN =====',
        `  Tên đăng nhập: ${app.seeded.username}`,
        `  Mật khẩu:      ${app.seeded.password}`,
        '  Hãy đổi mật khẩu ngay sau khi đăng nhập.',
        '  ====================================',
        '',
        '',
      ].join('\n'),
    );
    console.log('Đã tạo tài khoản Admin đầu tiên (mật khẩu chỉ hiện trên màn hình).');
  }

  const shutdown = () => {
    app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Không khởi động được server:', error);
  process.exit(1);
});
