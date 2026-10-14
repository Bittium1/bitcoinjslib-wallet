describe('WifPrivateKey', function() {
  var mainnetUncompressed = '5J3mBbAH58CpQ3Y5RNJpUKPE62SQ5tfcvU2JpbnkeyhfsYB1Jcn';
  var mainnetCompressed = 'KxFC1jmwwCoACiCAWZ3eXa96mBM6tb3TYzGmf6YwgdGWZgawvrtJ';
  var testnetCompressed = 'cMceqPhHedrhbcR9eXgzmfWy7kRqLyAxMYwFT6ABDWsiwUp9Nsq9';

  it('parses an official uncompressed mainnet WIF example', function() {
    var result = WifPrivateKey.parse(mainnetUncompressed, false);
    expect(result.valid).toEqual(true);
    expect(result.compressed).toEqual(false);
    expect(result.key.getAddress(0).toString()).toEqual('1424C2F4bC9JidNjjTUZCbUxv6Sa1Mt62x');
  });

  it('parses an official compressed mainnet WIF example', function() {
    var result = WifPrivateKey.parse(mainnetCompressed, false);
    expect(result.valid).toEqual(true);
    expect(result.compressed).toEqual(true);
    expect(result.key.getAddress(0).toString()).toEqual('1J7mdg5rbQyUHENYdx39WVWK7fsLpEoXZy');
  });

  it('parses a compressed testnet WIF only on testnet', function() {
    var testnetResult = WifPrivateKey.parse(testnetCompressed, true);
    var mainnetResult = WifPrivateKey.parse(testnetCompressed, false);
    expect(testnetResult.valid).toEqual(true);
    expect(testnetResult.key.getAddress(111).toString()).toEqual('mrcNu71ztWjAQA6ww9kHiW3zBWSQidHXTQ');
    expect(mainnetResult.valid).toEqual(false);
    expect(mainnetResult.code).toEqual('network');
  });

  it('rejects a mainnet WIF on testnet', function() {
    var result = WifPrivateKey.parse(mainnetCompressed, true);
    expect(result.valid).toEqual(false);
    expect(result.code).toEqual('network');
  });

  it('rejects an invalid Base58Check checksum', function() {
    var result = WifPrivateKey.parse(
      mainnetCompressed.substring(0, mainnetCompressed.length - 1) + '1',
      false
    );
    expect(result.valid).toEqual(false);
    expect(result.code).toEqual('checksum');
  });

  it('rejects zero and malformed private-key payloads', function() {
    var zeroWif = Bitcoin.base58check.encode(new Array(32).fill(0), 0x80);
    var badCompression = new Array(32).fill(1);
    badCompression.push(2);
    var malformedWif = Bitcoin.base58check.encode(badCompression, 0x80);

    expect(WifPrivateKey.parse(zeroWif, false).code).toEqual('range');
    expect(WifPrivateKey.parse(malformedWif, false).code).toEqual('payload');
  });

  it('signs a P2PKH transaction with the imported WIF key', function() {
    var source = WifPrivateKey.parse(mainnetCompressed, false).key;
    var destination = WifPrivateKey.parse(mainnetUncompressed, false).key;
    var sourceAddress = source.getAddress(0).toString();
    var sourceScript = Bitcoin.Script.createOutputScript(source.getAddress(0));
    var unspents = [{
      txHash: new Array(65).join('0'),
      index: 0,
      scriptPubKey: Bitcoin.convert.bytesToHex(sourceScript.buffer),
      value: 100000,
      address: sourceAddress
    }];

    TX.init(source);
    TX.parseInputs(JSON.stringify(unspents), sourceAddress);
    TX.addOutput(destination.getAddress(0).toString(), 0.0005);
    TX.addOutput(sourceAddress, 0.0004);
    var transaction = TX.construct();

    expect(transaction.ins[0].script.chunks.length).toEqual(2);
    expect(transaction.ins[0].script.chunks[1].length).toEqual(33);
  });
});
