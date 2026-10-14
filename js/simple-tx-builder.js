// A deliberately small, legacy P2PKH transaction builder.
// It creates and signs a raw transaction, but never broadcasts it.
var SimpleTransactionBuilder = (function() {
  'use strict';

  var SATOSHIS_PER_BTC = 100000000;
  var DUST_LIMIT = 546;
  var MAX_SAFE_INTEGER = 9007199254740991;

  function fail(message) {
    throw new Error(message);
  }

  function trim(value) {
    return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
  }

  function parseBtc(value, allowZero) {
    var text = trim(value);
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(text))
      fail('Enter a BTC amount with no more than 8 decimal places.');

    var parts = text.split('.');
    var whole = parts[0].replace(/^0+(?=[0-9])/, '');
    var fraction = (parts[1] || '') + '00000000';
    var satoshiText = (whole + fraction.substring(0, 8)).replace(/^0+(?=[0-9])/, '');

    if (satoshiText.length > String(MAX_SAFE_INTEGER).length ||
        (satoshiText.length == String(MAX_SAFE_INTEGER).length &&
         satoshiText > String(MAX_SAFE_INTEGER)))
      fail('The BTC amount is too large.');

    var satoshis = Number(satoshiText);
    if (!allowZero && satoshis == 0)
      fail('The BTC amount must be greater than zero.');
    return satoshis;
  }

  function formatBtc(satoshis) {
    if (!Number.isSafeInteger(satoshis) || satoshis < 0)
      fail('Invalid satoshi amount.');

    var whole = Math.floor(satoshis / SATOSHIS_PER_BTC);
    var fraction = String(satoshis % SATOSHIS_PER_BTC);
    while (fraction.length < 8)
      fraction = '0' + fraction;
    return whole + '.' + fraction;
  }

  function parseAddress(value, useTestnet) {
    var address = trim(value);
    var decoded;
    try {
      decoded = Bitcoin.base58check.decode(address);
    } catch (err) {
      fail('Enter a valid legacy Base58Check Bitcoin address.');
    }

    if (!decoded.payload || decoded.payload.length != 20)
      fail('The destination address has an invalid payload.');

    var p2pkhVersion = useTestnet ? 111 : 0;
    var p2shVersion = useTestnet ? 196 : 5;
    if (decoded.version != p2pkhVersion && decoded.version != p2shVersion)
      fail(useTestnet ?
        'The address is not a testnet address.' :
        'The address is not a Bitcoin mainnet address.');

    return {
      address: address,
      version: decoded.version,
      type: decoded.version == p2pkhVersion ? 'p2pkh' : 'p2sh'
    };
  }

  function normalizeUtxos(utxos, sourceAddress, useTestnet) {
    if (!Array.isArray(utxos))
      fail('The unspent-output response is invalid.');

    var source = parseAddress(sourceAddress, useTestnet);
    if (source.type != 'p2pkh')
      fail('Only a legacy P2PKH source address can be signed by this wallet.');

    var expectedScript = Bitcoin.convert.bytesToHex(
      Bitcoin.Script.createOutputScript(sourceAddress).buffer
    ).toLowerCase();
    var seen = {};

    return utxos.map(function(utxo) {
      var txHash = trim(utxo && utxo.txHash).toLowerCase();
      var index = utxo && Number(utxo.index);
      var value = utxo && Number(utxo.value);
      var scriptPubKey = trim(utxo && utxo.scriptPubKey).toLowerCase();

      if (!/^[0-9a-f]{64}$/.test(txHash))
        fail('An unspent output has an invalid transaction hash.');
      if (!Number.isInteger(index) || index < 0 || index > 4294967295)
        fail('An unspent output has an invalid output index.');
      if (!Number.isSafeInteger(value) || value <= 0)
        fail('An unspent output has an invalid value.');
      if (!/^(?:[0-9a-f]{2})+$/.test(scriptPubKey))
        fail('An unspent output has an invalid script.');
      if (scriptPubKey != expectedScript)
        fail('An unspent output does not belong to the selected source key.');

      var outpoint = txHash + ':' + index;
      if (seen[outpoint])
        fail('The unspent-output list contains a duplicate outpoint.');
      seen[outpoint] = true;

      return {
        txHash: txHash,
        index: index,
        value: value,
        scriptPubKey: scriptPubKey
      };
    });
  }

  function compareUtxos(left, right) {
    if (left.value != right.value)
      return right.value - left.value;
    if (left.txHash < right.txHash)
      return -1;
    if (left.txHash > right.txHash)
      return 1;
    return left.index - right.index;
  }

  function addSafe(left, right, message) {
    var result = left + right;
    if (!Number.isSafeInteger(result))
      fail(message || 'The transaction amount is too large.');
    return result;
  }

  function build(options) {
    options = options || {};
    var key = options.key;
    var useTestnet = !!options.useTestnet;
    if (!key || typeof key.sign != 'function' || typeof key.getAddress != 'function')
      fail('A private key is required to sign the transaction.');

    var sourceAddress = key.getAddress(useTestnet ? 111 : 0).toString();
    parseAddress(sourceAddress, useTestnet);
    var destination = parseAddress(options.destination, useTestnet);
    var amountSats = parseBtc(options.amountBtc, false);
    var requestedFeeSats = parseBtc(options.feeBtc, false);

    if (amountSats < DUST_LIMIT)
      fail('The payment amount must be at least 0.00000546 BTC.');

    var needed = addSafe(amountSats, requestedFeeSats);
    var candidates = normalizeUtxos(options.utxos, sourceAddress, useTestnet)
      .slice()
      .sort(compareUtxos);
    var selected = [];
    var selectedSats = 0;

    for (var i = 0; i < candidates.length && selectedSats < needed; i++) {
      selected.push(candidates[i]);
      selectedSats = addSafe(selectedSats, candidates[i].value, 'The selected input value is too large.');
    }

    if (selectedSats < needed)
      fail('Insufficient funds for the payment amount and fee.');

    var changeSats = selectedSats - needed;
    var actualFeeSats = requestedFeeSats;
    if (changeSats > 0 && changeSats < DUST_LIMIT) {
      actualFeeSats = addSafe(actualFeeSats, changeSats);
      changeSats = 0;
    }

    var transaction = new Bitcoin.Transaction();
    var connectedScripts = [];
    selected.forEach(function(utxo) {
      var connectedScript = new Bitcoin.Script(Bitcoin.convert.hexToBytes(utxo.scriptPubKey));
      transaction.addInput(new Bitcoin.TransactionIn({
        outpoint: { hash: utxo.txHash, index: utxo.index },
        script: connectedScript,
        sequence: [255, 255, 255, 255]
      }));
      connectedScripts.push(connectedScript);
    });

    transaction.addOutput(
      destination.address,
      new Bitcoin.BigInteger(String(amountSats), 10)
    );
    if (changeSats >= DUST_LIMIT) {
      transaction.addOutput(
        sourceAddress,
        new Bitcoin.BigInteger(String(changeSats), 10)
      );
    }

    var hashType = 1;
    for (var inputIndex = 0; inputIndex < transaction.ins.length; inputIndex++) {
      var hash = transaction.hashTransactionForSignature(
        connectedScripts[inputIndex],
        inputIndex,
        hashType
      );
      var signature = key.sign(hash);
      signature.push(hashType);
      var inputScript = new Bitcoin.Script();
      inputScript.writeBytes(signature);
      inputScript.writeBytes(key.getPub().toBytes());
      transaction.ins[inputIndex].script = inputScript;
    }

    return {
      transaction: transaction,
      rawHex: Bitcoin.convert.bytesToHex(transaction.serialize()),
      sourceAddress: sourceAddress,
      destinationAddress: destination.address,
      selectedInputCount: selected.length,
      selectedSats: selectedSats,
      amountSats: amountSats,
      requestedFeeSats: requestedFeeSats,
      actualFeeSats: actualFeeSats,
      changeSats: changeSats
    };
  }

  return {
    SATOSHIS_PER_BTC: SATOSHIS_PER_BTC,
    DUST_LIMIT: DUST_LIMIT,
    parseBtc: parseBtc,
    formatBtc: formatBtc,
    parseAddress: parseAddress,
    normalizeUtxos: normalizeUtxos,
    build: build
  };
})();
