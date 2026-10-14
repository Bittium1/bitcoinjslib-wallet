'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const {
  LocalBackendError,
  addressDetails,
  decodeBase58Check,
  safeStaticFile,
  startWalletServer
} = require('../backend');

const MAINNET_ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const SOURCE_ADDRESS = '1J7mdg5rbQyUHENYdx39WVWK7fsLpEoXZy';
const MAINNET_GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (body)
      req.write(body);
    req.end();
  });
}

test('decodes a mainnet Base58Check P2PKH address', () => {
  const decoded = decodeBase58Check(MAINNET_ADDRESS);
  assert.equal(decoded.version, 0);
  assert.equal(decoded.publicKeyHash.length, 20);
  assert.equal(addressDetails(MAINNET_ADDRESS, 'main').scriptPubKey.length, 50);
});

test('rejects a bad checksum and the wrong network', () => {
  assert.throws(
    () => decodeBase58Check(MAINNET_ADDRESS.slice(0, -1) + 'b'),
    LocalBackendError
  );
  assert.throws(
    () => addressDetails(MAINNET_ADDRESS, 'test'),
    /does not belong/
  );
});

test('allows only approved application asset paths', () => {
  const root = path.resolve(__dirname, '..', '..');
  assert.equal(safeStaticFile(root, '/app.html'), path.join(root, 'app.html'));
  assert.equal(safeStaticFile(root, '/js/consts.js'), path.join(root, 'js', 'consts.js'));
  assert.equal(safeStaticFile(root, '/../package.json'), null);
  assert.equal(safeStaticFile(root, '/desktop/main.js'), null);
});

test('serves the wallet and local API without broadcasting', async (t) => {
  let broadcastCalls = 0;
  const source = addressDetails(SOURCE_ADDRESS, 'main');
  const fakeCore = {
    blockchainInfo: async () => ({
      chain: 'main', blocks: 900000, headers: 900000,
      initialblockdownload: false, verificationprogress: 1
    }),
    genesisHash: async () => MAINNET_GENESIS,
    sendRawTransaction: async () => {
      broadcastCalls += 1;
      return 'not-used';
    }
  };
  const fakeElectrum = {
    validateHost: async () => {},
    requestMany: async (calls) => calls.map(([method]) => {
      if (method === 'server.version')
        return ['test-electrum', '1.4'];
      if (method === 'server.features')
        return { genesis_hash: MAINNET_GENESIS };
      if (method === 'blockchain.scripthash.get_balance')
        return { confirmed: 100000, unconfirmed: -1000 };
      if (method === 'blockchain.headers.subscribe')
        return { height: 900000 };
      if (method === 'blockchain.scripthash.listunspent')
        return [{ tx_hash: 'a'.repeat(64), tx_pos: 1, height: 899999, value: 100000 }];
      throw new Error(`Unexpected method: ${method}`);
    })
  };

  const backend = await startWalletServer({
    root: path.resolve(__dirname, '..', '..'),
    core: fakeCore,
    electrum: fakeElectrum,
    broadcastEnabled: false,
    port: 0
  });
  t.after(() => backend.close());

  const appResponse = await request({
    host: '127.0.0.1', port: backend.port, path: '/app.html?testnet=0', method: 'GET'
  });
  assert.equal(appResponse.status, 200);
  assert.match(appResponse.body, /Simple Transaction Builder/);
  assert.match(appResponse.headers['content-security-policy'], /script-src 'self'/);

  const statusResponse = await request({
    host: '127.0.0.1', port: backend.port, path: '/api/status', method: 'GET'
  });
  assert.equal(statusResponse.status, 200);
  const status = JSON.parse(statusResponse.body);
  assert.equal(status.chain, 'main');
  assert.equal(status.broadcastEnabled, false);

  const addressResponse = await request({
    host: '127.0.0.1', port: backend.port,
    path: `/api/addresses?addresses=${encodeURIComponent(SOURCE_ADDRESS)}`,
    method: 'GET'
  });
  assert.equal(addressResponse.status, 200);
  assert.equal(JSON.parse(addressResponse.body).data.addresses[0].balance, 99000);

  const unspentResponse = await request({
    host: '127.0.0.1', port: backend.port,
    path: `/api/addresses/${SOURCE_ADDRESS}/unspents?limit=100`,
    method: 'GET'
  });
  const unspent = JSON.parse(unspentResponse.body).data.unspents[0];
  assert.equal(unspent.scriptPubKey, source.scriptPubKey);
  assert.equal(unspent.confirmations, 2);

  const body = JSON.stringify({ rawTxHex: '00' });
  const broadcastResponse = await request({
    host: '127.0.0.1', port: backend.port, path: '/api/transactions', method: 'POST',
    headers: {
      Origin: `http://127.0.0.1:${backend.port}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  assert.equal(broadcastResponse.status, 403);
  assert.equal(broadcastCalls, 0);
});
