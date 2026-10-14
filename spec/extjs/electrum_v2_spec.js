describe('ElectrumV2', function() {
  var standardSeed = 'cram swing cover prefer miss modify ritual silly deliver chunk behind inform able';

  it('detects the official Electrum v2 seed prefixes', function() {
    expect(ElectrumV2.seedType(standardSeed)).toEqual('standard');
    expect(ElectrumV2.seedType('frost pig brisk excite novel report camera enlist axis nation novel desert')).toEqual('segwit');
    expect(ElectrumV2.seedType('science dawn member doll dutch real can brick knife deny drive list')).toEqual('2fa');
    expect(ElectrumV2.seedType('agree install')).toEqual('2fa_segwit');
    expect(ElectrumV2.seedType('not an electrum seed')).toEqual('');
  });

  it('normalizes case and whitespace before checking the seed version', function() {
    var variant = '  CrAm   swing cover prefer miss modify ritual silly deliver chunk behind inform able  ';
    expect(ElectrumV2.seedType(variant)).toEqual('standard');
  });

  it('matches the official Japanese mnemonic-to-seed vector', function() {
    var mnemonic = 'なのか ひろい しなん まなぶ つぶす さがす おしゃれ かわく おいかける けさき かいとう さたん';
    var bytes = ElectrumV2.mnemonicToSeed(mnemonic, '');
    expect(Bitcoin.convert.bytesToHex(bytes)).toEqual(
      'd3eaf0e44ddae3a5769cb08a26918e8b308258bcb057bb704c6f69713245c0b3' +
      '5cb92c03df9c9ece5eff826091b4e74041e010b701d44d610976ce8bfb66a8ad'
    );
  });

  it('matches the official PBKDF2 seed-extension vector', function() {
    var bytes = ElectrumV2.mnemonicToSeed('foobar', 'none');
    expect(Bitcoin.convert.bytesToHex(bytes)).toEqual(
      '741b72fd15effece6bfe5a26a52184f66811bd2be363190e07a42cca442b1a5b' +
      'b22b3ad0eb338197287e6d314866c7fba863ac65d3f156087a5052ebc7157fce'
    );
  });

  it('matches the official accented seed and extension vector', function() {
    var mnemonic = 'almíbar tibio superar vencer hacha peatón príncipe matar consejo polen vehículo odisea';
    var extension = 'araña difícil solución término cárcel';
    var bytes = ElectrumV2.mnemonicToSeed(mnemonic, extension);
    expect(Bitcoin.convert.bytesToHex(bytes)).toEqual(
      '363dec0e575b887cfccebee4c84fca5a3a6bed9d0e099c061fa6b85020b031f8' +
      'fe3636d9af187bf432d451273c625e20f24f651ada41aae2c4ea62d87e9fa44c'
    );
  });

  it('derives compressed P2PKH receiving keys at m/0/i', function() {
    var keys = ElectrumV2.deriveReceivingKeys(standardSeed, '', 3, false);
    expect(keys.length).toEqual(3);
    expect(keys[0].compressed).toEqual(true);
    expect(keys[0].getAddress().toString()).toEqual('15LbmqfK953XRFukmCmd9kqTsa2KGs6BAt');
    expect(keys[1].getAddress().toString()).toEqual('1HSnGWesTjrgha3iPvf9pqvhA8MLwy6BNc');
    expect(keys[2].getAddress().toString()).toEqual('1Gt7QafgoyG4mnq3uJz6zPpXxK66BdTfME');
  });

  it('does not derive unsupported v2 seed types with the legacy engine', function() {
    expect(function() {
      ElectrumV2.deriveReceivingKeys(
        'frost pig brisk excite novel report camera enlist axis nation novel desert',
        '',
        1,
        false
      );
    }).toThrow();
  });

  it('signs a legacy P2PKH transaction with a derived compressed key', function() {
    var keys = ElectrumV2.deriveReceivingKeys(standardSeed, '', 2, false);
    var sourceAddress = keys[0].getAddress().toString();
    var sourceScript = Bitcoin.Script.createOutputScript(keys[0].getAddress());
    var unspents = [{
      txHash: new Array(65).join('0'),
      index: 0,
      scriptPubKey: Bitcoin.convert.bytesToHex(sourceScript.buffer),
      value: 100000,
      address: sourceAddress
    }];

    TX.init(keys[0]);
    TX.parseInputs(JSON.stringify(unspents), sourceAddress);
    TX.addOutput(keys[1].getAddress().toString(), 0.0005);
    TX.addOutput(sourceAddress, 0.0004);
    var transaction = TX.construct();

    expect(transaction.ins.length).toEqual(1);
    expect(transaction.ins[0].script.chunks.length).toEqual(2);
    expect(transaction.ins[0].script.chunks[1].length).toEqual(33);
  });
});
