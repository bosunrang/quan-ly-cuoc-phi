'use strict';

const assert = require('node:assert/strict');
const {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { createAutomaticBackup, pruneBackups } = require('../../server/automatic-backup.cjs');

test('backup tự động tạo snapshot nhất quán và giữ một bản mỗi ngày', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cost-app-backup-'));
  const dbFile = join(root, 'cost-app.sqlite');
  const backupDir = join(root, 'backups');
  const db = new DatabaseSync(dbFile);

  try {
    db.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('ban-dau')");
    const date = new Date(2026, 9, 1, 8, 30);
    const first = await createAutomaticBackup(db, dbFile, backupDir, { date });
    assert.equal(first.created, true);
    assert.equal(existsSync(first.path), true);
    // Bản tạo thật có mtime hiện tại; cố định về ngày giả lập để kiểm tra dọn backup ổn định.
    utimesSync(first.path, date, date);

    db.exec("UPDATE sample SET value = 'sau-do'");
    const second = await createAutomaticBackup(db, dbFile, backupDir, { date });
    assert.equal(second.created, false);
    assert.equal(second.path, first.path);
    assert.deepEqual(readdirSync(backupDir), ['cost-app-2026-10-01.sqlite']);

    const snapshot = new DatabaseSync(first.path, { readOnly: true });
    assert.equal(snapshot.prepare('SELECT value FROM sample').get().value, 'ban-dau');
    snapshot.close();

    for (let day = 2; day <= 16; day += 1) {
      const simulated = join(backupDir, `cost-app-2026-10-${String(day).padStart(2, '0')}.sqlite`);
      writeFileSync(simulated, 'snapshot');
      const modifiedAt = new Date(2026, 9, day, 8, 30);
      utimesSync(simulated, modifiedAt, modifiedAt);
    }
    pruneBackups(backupDir, 'cost-app', 14);
    const retained = readdirSync(backupDir).sort();
    assert.equal(retained.length, 14);
    assert.equal(retained[0], 'cost-app-2026-10-03.sqlite');
    assert.equal(retained.at(-1), 'cost-app-2026-10-16.sqlite');
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
