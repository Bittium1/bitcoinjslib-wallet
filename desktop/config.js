'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONFIG_FILE_NAME = 'wallet-config.json';

function findOnPath(executable, env) {
  const pathValue = env.PATH || env.Path || env.path || '';
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory)
      continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, executable + extension);
      if (fs.existsSync(candidate))
        return candidate;
    }
  }
  return null;
}

function defaultBitcoinDataDir(platform, homeDir, env) {
  if (platform === 'win32')
    return path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'Bitcoin');
  if (platform === 'darwin')
    return path.join(homeDir, 'Library', 'Application Support', 'Bitcoin');
  return path.join(homeDir, '.bitcoin');
}

function defaultBitcoinCli(platform, env) {
  const fromPath = findOnPath('bitcoin-cli', env);
  if (fromPath)
    return fromPath;

  const candidates = platform === 'win32' ? [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Bitcoin', 'daemon', 'bitcoin-cli.exe')
  ] : platform === 'darwin' ? [
    '/opt/homebrew/bin/bitcoin-cli',
    '/usr/local/bin/bitcoin-cli',
    '/Applications/Bitcoin-Qt.app/Contents/MacOS/bitcoin-cli',
    '/Applications/Bitcoin Core.app/Contents/MacOS/bitcoin-cli'
  ] : [
    '/usr/bin/bitcoin-cli',
    '/usr/local/bin/bitcoin-cli'
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || 'bitcoin-cli';
}

function parseBoolean(value, fallback) {
  if (value == null || value === '')
    return fallback;
  if (typeof value === 'boolean')
    return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized))
    return true;
  if (['0', 'false', 'no', 'off'].includes(normalized))
    return false;
  throw new Error('broadcastEnabled must be true or false');
}

function parsePort(value, name, allowZero) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > 65535)
    throw new Error(`${name} must be an integer between ${minimum} and 65535`);
  return parsed;
}

function createDefaults({ platform, homeDir, env }) {
  return {
    bitcoinCli: defaultBitcoinCli(platform, env),
    bitcoinDataDir: defaultBitcoinDataDir(platform, homeDir, env),
    electrumHost: '127.0.0.1',
    electrumPort: 50001,
    port: 0,
    broadcastEnabled: true
  };
}

function loadDesktopConfig(options) {
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const env = options.env || process.env;
  const userDataPath = path.resolve(options.userDataPath);
  const configPath = path.join(userDataPath, CONFIG_FILE_NAME);
  const defaults = createDefaults({ platform, homeDir, env });

  fs.mkdirSync(userDataPath, { recursive: true });
  if (!fs.existsSync(configPath))
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });

  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error('wallet-config.json is not valid JSON');
  }
  if (!saved || Array.isArray(saved) || typeof saved !== 'object')
    throw new Error('wallet-config.json must contain a JSON object');

  const config = { ...defaults, ...saved };
  if (env.BITCOINJS_WALLET_BITCOIN_CLI)
    config.bitcoinCli = env.BITCOINJS_WALLET_BITCOIN_CLI;
  if (env.BITCOINJS_WALLET_DATADIR)
    config.bitcoinDataDir = env.BITCOINJS_WALLET_DATADIR;
  if (env.BITCOINJS_WALLET_ELECTRUM_HOST)
    config.electrumHost = env.BITCOINJS_WALLET_ELECTRUM_HOST;
  if (env.BITCOINJS_WALLET_ELECTRUM_PORT)
    config.electrumPort = env.BITCOINJS_WALLET_ELECTRUM_PORT;
  if (env.BITCOINJS_WALLET_PORT)
    config.port = env.BITCOINJS_WALLET_PORT;
  if (env.BITCOINJS_WALLET_BROADCAST_ENABLED)
    config.broadcastEnabled = env.BITCOINJS_WALLET_BROADCAST_ENABLED;

  if (typeof config.bitcoinCli !== 'string' || !config.bitcoinCli.trim())
    throw new Error('bitcoinCli must be a non-empty path or command');
  if (typeof config.bitcoinDataDir !== 'string' || !config.bitcoinDataDir.trim())
    throw new Error('bitcoinDataDir must be a non-empty path');
  if (typeof config.electrumHost !== 'string' || !config.electrumHost.trim())
    throw new Error('electrumHost must be a non-empty loopback host');

  return {
    configPath,
    bitcoinCli: config.bitcoinCli.trim(),
    bitcoinDataDir: config.bitcoinDataDir.trim(),
    electrumHost: config.electrumHost.trim(),
    electrumPort: parsePort(config.electrumPort, 'electrumPort', false),
    port: parsePort(config.port, 'port', true),
    broadcastEnabled: parseBoolean(config.broadcastEnabled, true)
  };
}

module.exports = {
  CONFIG_FILE_NAME,
  createDefaults,
  defaultBitcoinCli,
  defaultBitcoinDataDir,
  findOnPath,
  loadDesktopConfig,
  parseBoolean,
  parsePort
};
