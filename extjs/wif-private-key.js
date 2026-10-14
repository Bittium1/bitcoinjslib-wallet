// Strict Wallet Import Format (WIF) parsing for single-key P2PKH wallets.
var WifPrivateKey = (function() {
  'use strict';

  var MAINNET_VERSION = 0x80;
  var TESTNET_VERSION = 0xEF;

  function trimInput(value) {
    return String(value || '').replace(/^\s+|\s+$/g, '');
  }

  function isCandidate(value) {
    value = trimInput(value);
    return /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{51,52}$/.test(value);
  }

  function failure(code, message) {
    return {
      valid: false,
      code: code,
      message: message
    };
  }

  function parse(value, useTestnet) {
    value = trimInput(value);
    if (!isCandidate(value))
      return failure('not_wif', 'The value is not a WIF private key.');

    var decoded;
    try {
      decoded = Bitcoin.base58check.decode(value);
    } catch (err) {
      return failure('checksum', 'The WIF private-key checksum is invalid.');
    }

    var expectedVersion = useTestnet ? TESTNET_VERSION : MAINNET_VERSION;
    if (decoded.version != expectedVersion) {
      return failure(
        'network',
        useTestnet ?
          'This WIF private key is not encoded for testnet.' :
          'This WIF private key is not encoded for Bitcoin mainnet.'
      );
    }

    var payload = Array.prototype.slice.call(decoded.payload, 0);
    var compressed;
    if (payload.length == 32) {
      compressed = false;
    } else if (payload.length == 33 && payload[32] == 0x01) {
      compressed = true;
      payload = payload.slice(0, 32);
    } else {
      return failure('payload', 'The WIF private key has an invalid payload or compression marker.');
    }

    var key = new Bitcoin.ECKey(payload, compressed);
    var curveOrder = Bitcoin.getSECCurveByName('secp256k1').getN();
    if (key.priv.signum() <= 0 || key.priv.compareTo(curveOrder) >= 0)
      return failure('range', 'The WIF private key is outside the valid secp256k1 range.');

    return {
      valid: true,
      code: '',
      message: '',
      compressed: compressed,
      network: useTestnet ? 'testnet' : 'mainnet',
      key: key
    };
  }

  return {
    isCandidate: isCandidate,
    parse: parse
  };
})();
