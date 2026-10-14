'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { execFile } = require('node:child_process');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map(Array.from(BASE58_ALPHABET, (character, index) => [character, index]));
const CHAIN_ADDRESS_VERSION = { main: 0x00, test: 0x6f, signet: 0x6f, regtest: 0x6f };
const STATIC_PREFIXES = ['/css/', '/extjs/', '/js/', '/assets/'];
const STATIC_FILES = new Set(['/app.html']);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

class LocalBackendError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocalBackendError';
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

function decodeBase58Check(address) {
  if (!address || Array.from(address).some((character) => !BASE58_INDEX.has(character)))
    throw new LocalBackendError('Invalid Base58Check address');

  let number = 0n;
  for (const character of address)
    number = number * 58n + BigInt(BASE58_INDEX.get(character));

  let hex = number.toString(16);
  if (hex.length % 2)
    hex = `0${hex}`;
  let decoded = number === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  const leadingZeros = address.length - address.replace(/^1+/, '').length;
  decoded = Buffer.concat([Buffer.alloc(leadingZeros), decoded]);

  if (decoded.length !== 25)
    throw new LocalBackendError('Only legacy P2PKH addresses are supported');

  const payload = decoded.subarray(0, -4);
  const checksum = decoded.subarray(-4);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!crypto.timingSafeEqual(checksum, expected))
    throw new LocalBackendError('Invalid Base58Check checksum');
  if (payload.length !== 21)
    throw new LocalBackendError('Invalid P2PKH payload');

  return { version: payload[0], publicKeyHash: payload.subarray(1) };
}

function addressDetails(address, chain) {
  const expectedVersion = CHAIN_ADDRESS_VERSION[chain];
  if (expectedVersion === undefined)
    throw new LocalBackendError(`Unsupported Bitcoin Core chain: ${chain}`);

  const decoded = decodeBase58Check(address);
  if (decoded.version !== expectedVersion)
    throw new LocalBackendError(`Address does not belong to the local ${chain} chain`);

  const script = Buffer.concat([
    Buffer.from('76a914', 'hex'),
    decoded.publicKeyHash,
    Buffer.from('88ac', 'hex')
  ]);

  return {
    address,
    hash160: decoded.publicKeyHash.toString('hex'),
    scriptPubKey: script.toString('hex'),
    scripthash: Buffer.from(sha256(script)).reverse().toString('hex')
  };
}

async function ensureLoopback(host) {
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (error) {
    throw new LocalBackendError(`Cannot resolve Electrum host: ${host}`);
  }

  const loopback = (address) => {
    if (net.isIPv4(address))
      return address.startsWith('127.');
    if (net.isIPv6(address))
      return address === '::1' || address.toLowerCase() === '0:0:0:0:0:0:0:1';
    return false;
  };

  if (!addresses.length || addresses.some((entry) => !loopback(entry.address)))
    throw new LocalBackendError('Electrum host must resolve only to a loopback address');
}

class ElectrumClient {
  constructor(host, port, timeoutMs = 10000) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  async validateHost() {
    await ensureLoopback(this.host);
  }

  request(method, params = []) {
    return this.requestMany([[method, params]]).then((results) => results[0]);
  }

  requestMany(calls) {
    if (!calls.length)
      return Promise.resolve([]);

    return new Promise((resolve, reject) => {
      const responses = new Map();
      const requests = calls.map(([method, params], index) => ({
        jsonrpc: '2.0', id: index + 1, method, params
      }));
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffered = '';
      let settled = false;

      const finishWithError = () => {
        if (settled)
          return;
        settled = true;
        socket.destroy();
        reject(new LocalBackendError('Local Electrum server is unavailable'));
      };

      socket.setTimeout(this.timeoutMs, finishWithError);
      socket.once('error', finishWithError);
      socket.once('connect', () => {
        socket.write(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
      });
      socket.on('data', (chunk) => {
        buffered += chunk.toString('utf8');
        const lines = buffered.split('\n');
        buffered = lines.pop();

        try {
          for (const line of lines) {
            if (!line.trim())
              continue;
            const response = JSON.parse(line);
            if (response.id == null)
              continue;
            if (response.error) {
              const message = response.error.message || 'Electrum request failed';
              throw new LocalBackendError(String(message));
            }
            responses.set(Number(response.id), response.result);
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            socket.destroy();
            reject(error instanceof LocalBackendError ? error : new LocalBackendError('Local Electrum server returned invalid JSON'));
          }
          return;
        }

        if (!settled && responses.size === requests.length) {
          settled = true;
          socket.end();
          resolve(requests.map((request) => responses.get(request.id)));
        }
      });
      socket.once('end', () => {
        if (!settled)
          finishWithError();
      });
    });
  }
}

class BitcoinCoreCLI {
  constructor(executable, dataDir) {
    this.executable = executable;
    this.dataDir = dataDir;
  }

  run(...args) {
    const timeout = args[0] === 'sendrawtransaction' ? 30000 : 15000;
    const commandArgs = [
      `-datadir=${this.dataDir}`,
      '-rpcconnect=127.0.0.1',
      ...args
    ];

    return new Promise((resolve, reject) => {
      execFile(this.executable, commandArgs, {
        encoding: 'utf8',
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }, (error, stdout) => {
        if (error) {
          reject(new LocalBackendError('Local Bitcoin Core RPC rejected the request or is unavailable'));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async blockchainInfo() {
    const output = await this.run('getblockchaininfo');
    try {
      return JSON.parse(output);
    } catch (error) {
      throw new LocalBackendError('Bitcoin Core returned invalid JSON');
    }
  }

  genesisHash() {
    return this.run('getblockhash', '0');
  }

  sendRawTransaction(rawTransaction) {
    return this.run('sendrawtransaction', rawTransaction);
  }
}

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' https://mainnet.helloblock.io " +
      "https://testnet.helloblock.io https://blockchain.info; img-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'"
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', body.length);
  securityHeaders(response);
  response.end(body);
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function isStaticPathAllowed(urlPath) {
  return STATIC_FILES.has(urlPath) || STATIC_PREFIXES.some((prefix) => urlPath.startsWith(prefix));
}

function safeStaticFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (error) {
    return null;
  }
  if (!isStaticPathAllowed(decoded) || decoded.includes('\0'))
    return null;

  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, `.${decoded}`);
  if (candidate !== rootPath && !candidate.startsWith(rootPath + path.sep))
    return null;
  return candidate;
}

function parsePositiveInteger(value, field, minimum, maximum) {
  if (!/^[0-9]+$/.test(String(value)))
    throw new LocalBackendError(`Invalid ${field}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new LocalBackendError(`${field} must be between ${minimum} and ${maximum}`);
  return parsed;
}

function readJsonBody(request, maximumBytes = 1000000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > maximumBytes) {
        reject(new LocalBackendError('Invalid request size'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (length === 0) {
        reject(new LocalBackendError('Invalid request size'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new LocalBackendError('Invalid JSON request'));
      }
    });
    request.on('error', () => reject(new LocalBackendError('Invalid request')));
  });
}

function createRequestHandler(context) {
  return async function handleRequest(request, response) {
    const hostHeader = request.headers.host || '';
    const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost') {
      sendError(response, 400, 'Invalid Host header');
      return;
    }

    let parsed;
    try {
      parsed = new URL(request.url, `http://${hostHeader}`);
    } catch (error) {
      sendError(response, 400, 'Invalid request URL');
      return;
    }

    try {
      if (request.method === 'GET' && parsed.pathname === '/api/status') {
        const coreInfo = await context.core.blockchainInfo();
        sendJson(response, 200, {
          mode: 'desktop-local-primary',
          chain: context.chain,
          broadcastEnabled: context.broadcastEnabled,
          core: {
            blocks: coreInfo.blocks,
            headers: coreInfo.headers,
            initialBlockDownload: coreInfo.initialblockdownload,
            verificationProgress: coreInfo.verificationprogress
          },
          electrum: {
            server: context.electrumVersion[0],
            protocol: context.electrumVersion[1]
          }
        });
        return;
      }

      if (request.method === 'GET' && parsed.pathname === '/api/addresses') {
        const addresses = parsed.searchParams.getAll('addresses');
        if (!addresses.length || addresses.length > 50)
          throw new LocalBackendError('Provide between 1 and 50 addresses');
        const details = addresses.map((address) => addressDetails(address, context.chain));
        const balances = await context.electrum.requestMany(details.map((detail) => [
          'blockchain.scripthash.get_balance', [detail.scripthash]
        ]));
        const result = details.map((detail, index) => {
          const balance = balances[index] || {};
          const confirmed = Number(balance.confirmed || 0);
          const unconfirmed = Number(balance.unconfirmed || 0);
          return {
            address: detail.address,
            balance: confirmed + unconfirmed,
            confirmedBalance: confirmed,
            unconfirmedBalance: unconfirmed
          };
        });
        sendJson(response, 200, { data: { addresses: result } });
        return;
      }

      const unspentMatch = request.method === 'GET' && parsed.pathname.match(/^\/api\/addresses\/([^/]+)\/unspents$/);
      if (unspentMatch) {
        const address = decodeURIComponent(unspentMatch[1]);
        const limit = parsePositiveInteger(parsed.searchParams.get('limit') || '100', 'UTXO limit', 1, 500);
        const detail = addressDetails(address, context.chain);
        const [tip, outputs] = await context.electrum.requestMany([
          ['blockchain.headers.subscribe', []],
          ['blockchain.scripthash.listunspent', [detail.scripthash]]
        ]);
        const tipHeight = Number(tip.height || 0);
        const selected = Array.from(outputs || [])
          .sort((left, right) => Number(right.value) - Number(left.value) || Number(right.height) - Number(left.height))
          .slice(0, limit);
        const unspents = selected.map((output) => {
          const height = Number(output.height || 0);
          return {
            confirmations: height > 0 ? tipHeight - height + 1 : 0,
            blockHeight: height,
            txHash: output.tx_hash,
            index: Number(output.tx_pos),
            scriptPubKey: detail.scriptPubKey,
            type: 'pubkeyhash',
            value: Number(output.value),
            hash160: detail.hash160,
            address
          };
        });
        sendJson(response, 200, { data: { unspents } });
        return;
      }

      if (request.method === 'POST' && parsed.pathname === '/api/transactions') {
        const expectedOrigin = `http://127.0.0.1:${context.port}`;
        if (request.headers.origin !== expectedOrigin) {
          sendError(response, 403, 'Cross-origin requests are not allowed');
          return;
        }
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          sendError(response, 415, 'JSON request required');
          return;
        }
        if (!context.broadcastEnabled) {
          sendError(response, 403, 'Transaction broadcast is disabled in the desktop configuration');
          return;
        }

        const body = await readJsonBody(request);
        const rawTransaction = body && body.rawTxHex;
        if (typeof rawTransaction !== 'string' || !rawTransaction ||
            rawTransaction.length % 2 || !/^[0-9a-fA-F]+$/.test(rawTransaction))
          throw new LocalBackendError('Invalid raw transaction');
        const transactionId = await context.core.sendRawTransaction(rawTransaction);
        sendJson(response, 200, { data: { transaction: { txHash: transactionId } } });
        return;
      }

      if (parsed.pathname.startsWith('/api/')) {
        sendError(response, 404, 'Unknown local API route');
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendError(response, 405, 'Method not allowed');
        return;
      }

      if (parsed.pathname === '/' || parsed.pathname === '/app.html') {
        const localTestnet = context.chain !== 'main';
        const requestedTestnet = parsed.searchParams.get('testnet') !== '0' && parsed.searchParams.has('testnet');
        if (parsed.pathname === '/' || requestedTestnet !== localTestnet) {
          parsed.pathname = '/app.html';
          parsed.searchParams.set('testnet', localTestnet ? '1' : '0');
          response.statusCode = 302;
          response.setHeader('Location', `${parsed.pathname}?${parsed.searchParams.toString()}`);
          securityHeaders(response);
          response.end();
          return;
        }
      }

      const staticFile = safeStaticFile(context.root, parsed.pathname);
      if (!staticFile) {
        sendError(response, 404, 'Not found');
        return;
      }

      let stat;
      try {
        stat = await fs.promises.stat(staticFile);
      } catch (error) {
        sendError(response, 404, 'Not found');
        return;
      }
      if (!stat.isFile()) {
        sendError(response, 404, 'Not found');
        return;
      }

      response.statusCode = 200;
      response.setHeader('Content-Type', MIME_TYPES[path.extname(staticFile).toLowerCase()] || 'application/octet-stream');
      response.setHeader('Content-Length', stat.size);
      securityHeaders(response);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      fs.createReadStream(staticFile).on('error', () => {
        if (!response.headersSent)
          sendError(response, 500, 'Could not read application asset');
        else
          response.destroy();
      }).pipe(response);
    } catch (error) {
      const message = error instanceof LocalBackendError ? error.message : 'Local backend request failed';
      sendError(response, error instanceof LocalBackendError ? 400 : 502, message);
    }
  };
}

async function startWalletServer(options) {
  const electrum = options.electrum || new ElectrumClient(
    options.electrumHost || '127.0.0.1',
    Number(options.electrumPort || 50001)
  );
  const core = options.core || new BitcoinCoreCLI(options.bitcoinCli, options.bitcoinDataDir);

  if (typeof electrum.validateHost === 'function')
    await electrum.validateHost();
  const coreInfo = await core.blockchainInfo();
  const chain = String(coreInfo.chain || '');
  const coreGenesisHash = await core.genesisHash();
  const [electrumVersion, electrumFeatures] = await electrum.requestMany([
    ['server.version', ['bitcoinjslib-wallet-desktop', '1.4']],
    ['server.features', []]
  ]);

  if (!Object.prototype.hasOwnProperty.call(CHAIN_ADDRESS_VERSION, chain))
    throw new LocalBackendError(`Unsupported Bitcoin Core chain: ${chain}`);
  if (!electrumFeatures || electrumFeatures.genesis_hash !== coreGenesisHash)
    throw new LocalBackendError('Bitcoin Core and Electrum are on different chains');

  const context = {
    root: path.resolve(options.root),
    core,
    electrum,
    chain,
    electrumVersion,
    broadcastEnabled: options.broadcastEnabled !== false,
    port: 0
  };
  const server = http.createServer(createRequestHandler(context));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(options.port || 0), '127.0.0.1', resolve);
  });
  context.port = server.address().port;

  return {
    server,
    chain,
    port: context.port,
    url: `http://127.0.0.1:${context.port}/app.html`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

module.exports = {
  BitcoinCoreCLI,
  CHAIN_ADDRESS_VERSION,
  ElectrumClient,
  LocalBackendError,
  addressDetails,
  createRequestHandler,
  decodeBase58Check,
  ensureLoopback,
  isStaticPathAllowed,
  safeStaticFile,
  startWalletServer
};
