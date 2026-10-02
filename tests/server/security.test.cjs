'use strict';

const assert = require('node:assert/strict');
const {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const auth = require('../../server/auth.cjs');
const { createApp } = require('../../server/index.cjs');

test('giới hạn đăng nhập sai chỉ khóa cặp tài khoản và máy gửi yêu cầu', () => {
  const username = `kiemtra-${Date.now()}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    auth.recordFailedLogin(username, '192.168.1.20');
  }

  assert.ok(auth.loginBlockedFor(username, '192.168.1.20') > 0);
  assert.equal(auth.loginBlockedFor(username, '192.168.1.21'), 0);
  auth.clearFailedLogins(username, '192.168.1.20');
  assert.equal(auth.loginBlockedFor(username, '192.168.1.20'), 0);
});

test('API và giao diện production trả về security headers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cost-app-security-'));
  const staticRoot = join(root, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Test</title>');
  const app = createApp({
    dbFile: join(root, 'test.sqlite'),
    staticRoot,
  });

  try {
    const address = await app.listen(0, '127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;
    const api = await fetch(`${origin}/api/health`);
    assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(api.headers.get('x-frame-options'), 'DENY');
    assert.equal(api.headers.get('referrer-policy'), 'no-referrer');

    const html = await fetch(origin);
    const contentSecurityPolicy = html.headers.get('content-security-policy');
    assert.match(contentSecurityPolicy, /default-src 'self'/);
    assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
    assert.match(contentSecurityPolicy, /worker-src 'self' blob:/);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
