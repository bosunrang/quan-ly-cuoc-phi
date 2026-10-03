'use strict';

const { backup } = require('node:sqlite');
const {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} = require('node:fs');
const { basename, extname, join } = require('node:path');

const DEFAULT_RETENTION = 14;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Bản chụp tự động ngay trước mỗi lần khôi phục, để hoàn tác được nếu chọn nhầm.
const SAFETY_RETENTION = 5;
const SAFETY_LABEL = 'truoc-khoi-phuc';

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pruneBackups(backupDir, databaseName, retention = DEFAULT_RETENTION) {
  const pattern = new RegExp(
    `^${escapeRegex(databaseName)}-\\d{4}-\\d{2}-\\d{2}\\.sqlite$`,
  );
  const files = readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const path = join(backupDir, entry.name);
      return { path, modifiedAt: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const file of files.slice(retention)) unlinkSync(file.path);
}

async function createAutomaticBackup(
  db,
  dbFile,
  backupDir,
  { date = new Date(), retention = DEFAULT_RETENTION } = {},
) {
  mkdirSync(backupDir, { recursive: true });
  const databaseName = basename(dbFile, extname(dbFile));
  const destination = join(
    backupDir,
    `${databaseName}-${localDateStamp(date)}.sqlite`,
  );
  if (existsSync(destination)) {
    pruneBackups(backupDir, databaseName, retention);
    return { created: false, path: destination };
  }

  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    await backup(db, temporary);
    renameSync(temporary, destination);
    pruneBackups(backupDir, databaseName, retention);
    return { created: true, path: destination };
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function safetyStamp(date) {
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join('');
  return `${localDateStamp(date)}-${time}`;
}

/**
 * Các bản sao lưu dạng SQLite trong thư mục backup, mới nhất trước:
 * bản hằng ngày và bản chụp trước khi khôi phục.
 */
function listAutomaticBackups(dbFile, backupDir) {
  if (!backupDir || !existsSync(backupDir)) return [];
  const databaseName = escapeRegex(basename(dbFile, extname(dbFile)));
  const daily = new RegExp(`^${databaseName}-(\\d{4}-\\d{2}-\\d{2})\\.sqlite$`);
  const safety = new RegExp(
    `^${databaseName}-${SAFETY_LABEL}-(\\d{4}-\\d{2}-\\d{2})-(\\d{2})(\\d{2})(\\d{2})\\.sqlite$`,
  );
  return readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const dailyMatch = daily.exec(entry.name);
      const safetyMatch = safety.exec(entry.name);
      if (!dailyMatch && !safetyMatch) return null;
      const stat = statSync(join(backupDir, entry.name));
      return {
        fileName: entry.name,
        kind: dailyMatch ? 'daily' : 'before-restore',
        date: dailyMatch ? dailyMatch[1] : safetyMatch[1],
        time: safetyMatch ? `${safetyMatch[2]}:${safetyMatch[3]}:${safetyMatch[4]}` : null,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

/** Chụp nguyên trạng dữ liệu hiện tại trước khi bị thay thế bởi lần khôi phục. */
async function createSafetyBackup(db, dbFile, backupDir, { date = new Date() } = {}) {
  mkdirSync(backupDir, { recursive: true });
  const databaseName = basename(dbFile, extname(dbFile));
  const destination = join(
    backupDir,
    `${databaseName}-${SAFETY_LABEL}-${safetyStamp(date)}.sqlite`,
  );
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    await backup(db, temporary);
    renameSync(temporary, destination);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  const old = listAutomaticBackups(dbFile, backupDir)
    .filter((item) => item.kind === 'before-restore')
    .slice(SAFETY_RETENTION);
  for (const item of old) unlinkSync(join(backupDir, item.fileName));
  return { path: destination, fileName: basename(destination) };
}

function startAutomaticBackups(db, dbFile, backupDir) {
  let active = null;
  let stopped = false;

  const run = () => {
    if (stopped) return Promise.resolve(null);
    if (active) return active;
    active = createAutomaticBackup(db, dbFile, backupDir)
      .then((result) => {
        if (result.created) console.log(`Đã tạo backup tự động: ${result.path}`);
        return result;
      })
      .catch((error) => {
        console.warn('Không thể tạo backup tự động:', error.message);
        return null;
      })
      .finally(() => {
        active = null;
      });
    return active;
  };

  void run();
  const timer = setInterval(() => void run(), CHECK_INTERVAL_MS);
  timer.unref();

  return {
    run,
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (active) await active;
    },
  };
}

module.exports = {
  createAutomaticBackup,
  createSafetyBackup,
  listAutomaticBackups,
  pruneBackups,
  startAutomaticBackups,
  DEFAULT_RETENTION,
};
