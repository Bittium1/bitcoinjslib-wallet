'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { loadDesktopConfig, parseBoolean, parsePort } = require('../config');

test('creates and reloads a non-secret desktop configuration', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcoinjs-wallet-test-'));
  assert.ok(temporaryRoot.startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const first = loadDesktopConfig({
    userDataPath: temporaryRoot,
    platform: 'win32',
    homeDir: 'C:\\Users\\test',
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PATH: '' }
  });
  assert.equal(first.electrumHost, '127.0.0.1');
  assert.equal(first.electrumPort, 50001);
  assert.equal(first.broadcastEnabled, true);
  assert.ok(fs.existsSync(first.configPath));
  assert.doesNotMatch(fs.readFileSync(first.configPath, 'utf8'), /password|cookie|private/i);

  const saved = JSON.parse(fs.readFileSync(first.configPath, 'utf8'));
  saved.broadcastEnabled = false;
  saved.electrumPort = 60001;
  fs.writeFileSync(first.configPath, JSON.stringify(saved));
  const second = loadDesktopConfig({
    userDataPath: temporaryRoot,
    platform: 'win32',
    homeDir: 'C:\\Users\\test',
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PATH: '' }
  });
  assert.equal(second.broadcastEnabled, false);
  assert.equal(second.electrumPort, 60001);
});

test('validates boolean and port configuration values', () => {
  assert.equal(parseBoolean('false', true), false);
  assert.equal(parseBoolean('yes', false), true);
  assert.equal(parsePort('50001', 'electrumPort', false), 50001);
  assert.throws(() => parseBoolean('maybe', true));
  assert.throws(() => parsePort('0', 'electrumPort', false));
});
