describe('SimpleTransactionBuilder', function() {
  var sourceKey;
  var destinationKey;
  var sourceAddress;
  var destinationAddress;
  var sourceScript;

  function expectError(callback, messageFragment) {
    var message = '';
    try {
      callback();
    } catch (err) {
      message = err.message || String(err);
    }
    expect(message).toContain(messageFragment);
  }

  function utxo(txCharacter, index, value, script) {
    return {
      txHash: new Array(65).join(txCharacter),
      index: index,
      scriptPubKey: script || sourceScript,
      value: value,
      address: sourceAddress
    };
  }

  beforeEach(function() {
    sourceKey = WifPrivateKey.parse(
      'KxFC1jmwwCoACiCAWZ3eXa96mBM6tb3TYzGmf6YwgdGWZgawvrtJ',
      false
    ).key;
    destinationKey = WifPrivateKey.parse(
      '5J3mBbAH58CpQ3Y5RNJpUKPE62SQ5tfcvU2JpbnkeyhfsYB1Jcn',
      false
    ).key;
    sourceAddress = sourceKey.getAddress(0).toString();
    destinationAddress = destinationKey.getAddress(0).toString();
    sourceScript = Bitcoin.convert.bytesToHex(
      Bitcoin.Script.createOutputScript(sourceAddress).buffer
    );
  });

  it('parses and formats BTC amounts with exact satoshi precision', function() {
    expect(SimpleTransactionBuilder.parseBtc('1.00000001')).toEqual(100000001);
    expect(SimpleTransactionBuilder.parseBtc('0.00000001')).toEqual(1);
    expect(SimpleTransactionBuilder.formatBtc(100000001)).toEqual('1.00000001');
    expect(SimpleTransactionBuilder.formatBtc(1)).toEqual('0.00000001');
  });

  it('rejects negative, exponential, over-precise, and zero amounts', function() {
    expectError(function() { SimpleTransactionBuilder.parseBtc('-1'); }, '8 decimal');
    expectError(function() { SimpleTransactionBuilder.parseBtc('1e-8'); }, '8 decimal');
    expectError(function() { SimpleTransactionBuilder.parseBtc('0.000000001'); }, '8 decimal');
    expectError(function() { SimpleTransactionBuilder.parseBtc('0'); }, 'greater than zero');
  });

  it('accepts only legacy addresses from the selected network', function() {
    expect(SimpleTransactionBuilder.parseAddress(destinationAddress, false).type).toEqual('p2pkh');
    expect(SimpleTransactionBuilder.parseAddress(
      '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
      false
    ).type).toEqual('p2sh');
    expectError(function() {
      SimpleTransactionBuilder.parseAddress('mrcNu71ztWjAQA6ww9kHiW3zBWSQidHXTQ', false);
    }, 'mainnet');
    expectError(function() {
      SimpleTransactionBuilder.parseAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', false);
    }, 'legacy Base58Check');
  });

  it('selects inputs, creates change, and signs a raw P2PKH transaction', function() {
    var result = SimpleTransactionBuilder.build({
      key: sourceKey,
      utxos: [utxo('a', 1, 50000), utxo('b', 0, 60000)],
      destination: destinationAddress,
      amountBtc: '0.00090000',
      feeBtc: '0.00001000',
      useTestnet: false
    });

    expect(result.selectedInputCount).toEqual(2);
    expect(result.selectedSats).toEqual(110000);
    expect(result.amountSats).toEqual(90000);
    expect(result.actualFeeSats).toEqual(1000);
    expect(result.changeSats).toEqual(19000);
    expect(result.transaction.ins.length).toEqual(2);
    expect(result.transaction.outs.length).toEqual(2);
    expect(result.transaction.outs[0].value).toEqual(90000);
    expect(result.transaction.outs[1].value).toEqual(19000);
    expect(result.transaction.outs[0].address.toString()).toEqual(destinationAddress);
    expect(result.transaction.outs[1].address.toString()).toEqual(sourceAddress);
    expect(result.selectedSats).toEqual(
      result.amountSats + result.changeSats + result.actualFeeSats
    );
    expect(result.transaction.ins[0].outpoint.hash).toEqual(new Array(65).join('b'));
    expect(result.transaction.ins[0].script.chunks.length).toEqual(2);
    expect(result.transaction.ins[0].script.chunks[1].length).toEqual(33);
    expect(result.rawHex).toMatch(/^[0-9a-f]+$/);
  });

  it('absorbs change below the dust limit into the actual fee', function() {
    var result = SimpleTransactionBuilder.build({
      key: sourceKey,
      utxos: [utxo('c', 0, 100000)],
      destination: destinationAddress,
      amountBtc: '0.00098455',
      feeBtc: '0.00001000',
      useTestnet: false
    });

    expect(result.changeSats).toEqual(0);
    expect(result.actualFeeSats).toEqual(1545);
    expect(result.transaction.outs.length).toEqual(1);
  });

  it('rejects a dust payment and insufficient funds', function() {
    expectError(function() {
      SimpleTransactionBuilder.build({
        key: sourceKey,
        utxos: [utxo('d', 0, 100000)],
        destination: destinationAddress,
        amountBtc: '0.00000545',
        feeBtc: '0.00001000',
        useTestnet: false
      });
    }, 'at least');

    expectError(function() {
      SimpleTransactionBuilder.build({
        key: sourceKey,
        utxos: [utxo('e', 0, 1000)],
        destination: destinationAddress,
        amountBtc: '0.00001000',
        feeBtc: '0.00001000',
        useTestnet: false
      });
    }, 'Insufficient funds');
  });

  it('rejects an unspent output that is not locked to the selected key', function() {
    var foreignScript = Bitcoin.convert.bytesToHex(
      Bitcoin.Script.createOutputScript(destinationAddress).buffer
    );
    expectError(function() {
      SimpleTransactionBuilder.build({
        key: sourceKey,
        utxos: [utxo('f', 0, 100000, foreignScript)],
        destination: destinationAddress,
        amountBtc: '0.00050000',
        feeBtc: '0.00001000',
        useTestnet: false
      });
    }, 'does not belong');
  });
});
