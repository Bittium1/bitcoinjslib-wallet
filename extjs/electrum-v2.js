// Electrum v2 seed support for standard (legacy P2PKH) wallets.
// The normalization and seed-version rules mirror Electrum's mnemonic.py.
var ElectrumV2 = (function() {
  'use strict';

  var SEED_PREFIX_STANDARD = '01';
  var SEED_PREFIX_SEGWIT = '100';
  var SEED_PREFIX_2FA = '101';
  var SEED_PREFIX_2FA_SEGWIT = '102';

  // Unicode characters with a non-zero canonical combining class. Electrum
  // removes these after NFKD normalization. Stored as ranges for browsers
  // that do not expose the Unicode canonical-combining-class property.
  var COMBINING_RANGES = [
    [0x300, 0x34E], [0x350, 0x36F], [0x483, 0x487], [0x591, 0x5BD],
    [0x5BF, 0x5BF], [0x5C1, 0x5C2], [0x5C4, 0x5C5], [0x5C7, 0x5C7],
    [0x610, 0x61A], [0x64B, 0x65F], [0x670, 0x670], [0x6D6, 0x6DC],
    [0x6DF, 0x6E4], [0x6E7, 0x6E8], [0x6EA, 0x6ED], [0x711, 0x711],
    [0x730, 0x74A], [0x7EB, 0x7F3], [0x7FD, 0x7FD], [0x816, 0x819],
    [0x81B, 0x823], [0x825, 0x827], [0x829, 0x82D], [0x859, 0x85B],
    [0x898, 0x89F], [0x8CA, 0x8E1], [0x8E3, 0x8FF], [0x93C, 0x93C],
    [0x94D, 0x94D], [0x951, 0x954], [0x9BC, 0x9BC], [0x9CD, 0x9CD],
    [0x9FE, 0x9FE], [0xA3C, 0xA3C], [0xA4D, 0xA4D], [0xABC, 0xABC],
    [0xACD, 0xACD], [0xB3C, 0xB3C], [0xB4D, 0xB4D], [0xBCD, 0xBCD],
    [0xC3C, 0xC3C], [0xC4D, 0xC4D], [0xC55, 0xC56], [0xCBC, 0xCBC],
    [0xCCD, 0xCCD], [0xD3B, 0xD3C], [0xD4D, 0xD4D], [0xDCA, 0xDCA],
    [0xE38, 0xE3A], [0xE48, 0xE4B], [0xEB8, 0xEBA], [0xEC8, 0xECB],
    [0xF18, 0xF19], [0xF35, 0xF35], [0xF37, 0xF37], [0xF39, 0xF39],
    [0xF71, 0xF72], [0xF74, 0xF74], [0xF7A, 0xF7D], [0xF80, 0xF80],
    [0xF82, 0xF84], [0xF86, 0xF87], [0xFC6, 0xFC6], [0x1037, 0x1037],
    [0x1039, 0x103A], [0x108D, 0x108D], [0x135D, 0x135F], [0x1714, 0x1715],
    [0x1734, 0x1734], [0x17D2, 0x17D2], [0x17DD, 0x17DD], [0x18A9, 0x18A9],
    [0x1939, 0x193B], [0x1A17, 0x1A18], [0x1A60, 0x1A60], [0x1A75, 0x1A7C],
    [0x1A7F, 0x1A7F], [0x1AB0, 0x1ABD], [0x1ABF, 0x1ACE], [0x1B34, 0x1B34],
    [0x1B44, 0x1B44], [0x1B6B, 0x1B73], [0x1BAA, 0x1BAB], [0x1BE6, 0x1BE6],
    [0x1BF2, 0x1BF3], [0x1C37, 0x1C37], [0x1CD0, 0x1CD2], [0x1CD4, 0x1CE0],
    [0x1CE2, 0x1CE8], [0x1CED, 0x1CED], [0x1CF4, 0x1CF4], [0x1CF8, 0x1CF9],
    [0x1DC0, 0x1DFF], [0x20D0, 0x20DC], [0x20E1, 0x20E1], [0x20E5, 0x20F0],
    [0x2CEF, 0x2CF1], [0x2D7F, 0x2D7F], [0x2DE0, 0x2DFF], [0x302A, 0x302F],
    [0x3099, 0x309A], [0xA66F, 0xA66F], [0xA674, 0xA67D], [0xA69E, 0xA69F],
    [0xA6F0, 0xA6F1], [0xA806, 0xA806], [0xA82C, 0xA82C], [0xA8C4, 0xA8C4],
    [0xA8E0, 0xA8F1], [0xA92B, 0xA92D], [0xA953, 0xA953], [0xA9B3, 0xA9B3],
    [0xA9C0, 0xA9C0], [0xAAB0, 0xAAB0], [0xAAB2, 0xAAB4], [0xAAB7, 0xAAB8],
    [0xAABE, 0xAABF], [0xAAC1, 0xAAC1], [0xAAF6, 0xAAF6], [0xABED, 0xABED],
    [0xFB1E, 0xFB1E], [0xFE20, 0xFE2F], [0x101FD, 0x101FD], [0x102E0, 0x102E0],
    [0x10376, 0x1037A], [0x10A0D, 0x10A0D], [0x10A0F, 0x10A0F], [0x10A38, 0x10A3A],
    [0x10A3F, 0x10A3F], [0x10AE5, 0x10AE6], [0x10D24, 0x10D27], [0x10EAB, 0x10EAC],
    [0x10EFD, 0x10EFF], [0x10F46, 0x10F50], [0x10F82, 0x10F85], [0x11046, 0x11046],
    [0x11070, 0x11070], [0x1107F, 0x1107F], [0x110B9, 0x110BA], [0x11100, 0x11102],
    [0x11133, 0x11134], [0x11173, 0x11173], [0x111C0, 0x111C0], [0x111CA, 0x111CA],
    [0x11235, 0x11236], [0x112E9, 0x112EA], [0x1133B, 0x1133C], [0x1134D, 0x1134D],
    [0x11366, 0x1136C], [0x11370, 0x11374], [0x11442, 0x11442], [0x11446, 0x11446],
    [0x1145E, 0x1145E], [0x114C2, 0x114C3], [0x115BF, 0x115C0], [0x1163F, 0x1163F],
    [0x116B6, 0x116B7], [0x1172B, 0x1172B], [0x11839, 0x1183A], [0x1193D, 0x1193E],
    [0x11943, 0x11943], [0x119E0, 0x119E0], [0x11A34, 0x11A34], [0x11A47, 0x11A47],
    [0x11A99, 0x11A99], [0x11C3F, 0x11C3F], [0x11D42, 0x11D42], [0x11D44, 0x11D45],
    [0x11D97, 0x11D97], [0x11F41, 0x11F42], [0x16AF0, 0x16AF4], [0x16B30, 0x16B36],
    [0x16FF0, 0x16FF1], [0x1BC9E, 0x1BC9E], [0x1D165, 0x1D169], [0x1D16D, 0x1D172],
    [0x1D17B, 0x1D182], [0x1D185, 0x1D18B], [0x1D1AA, 0x1D1AD], [0x1D242, 0x1D244],
    [0x1E000, 0x1E006], [0x1E008, 0x1E018], [0x1E01B, 0x1E021], [0x1E023, 0x1E024],
    [0x1E026, 0x1E02A], [0x1E08F, 0x1E08F], [0x1E130, 0x1E136], [0x1E2AE, 0x1E2AE],
    [0x1E2EC, 0x1E2EF], [0x1E4EC, 0x1E4EF], [0x1E8D0, 0x1E8D6], [0x1E944, 0x1E94A]
  ];

  var CJK_RANGES = [
    [0x1100, 0x11FF], [0x2E80, 0x2EFF], [0x2F00, 0x2FDF],
    [0x2FF0, 0x2FFF], [0x3040, 0x309F], [0x30A0, 0x30FF],
    [0x3100, 0x312F], [0x3130, 0x318F], [0x3190, 0x319F],
    [0x31A0, 0x31BF], [0x31C0, 0x31EF], [0x31F0, 0x31FF],
    [0x3400, 0x4DBF], [0x4E00, 0x9FFF], [0xA000, 0xA48F],
    [0xA490, 0xA4CF], [0xA4D0, 0xA4FF], [0xA960, 0xA97F],
    [0xAC00, 0xD7AF], [0xD7B0, 0xD7FF], [0xF900, 0xFAFF],
    [0xFF00, 0xFFEF], [0x16F00, 0x16F9F], [0x1B000, 0x1B0FF],
    [0x20000, 0x2A6DF], [0x2A700, 0x2B73F], [0x2B740, 0x2B81F],
    [0x2F800, 0x2FA1D], [0xE0100, 0xE01EF]
  ];

  function isInRanges(codePoint, ranges) {
    var low = 0;
    var high = ranges.length - 1;
    while (low <= high) {
      var middle = (low + high) >> 1;
      var range = ranges[middle];
      if (codePoint < range[0])
        high = middle - 1;
      else if (codePoint > range[1])
        low = middle + 1;
      else
        return true;
    }
    return false;
  }

  function isWhitespace(codePoint) {
    return (codePoint >= 0x09 && codePoint <= 0x0D) ||
      (codePoint >= 0x1C && codePoint <= 0x20) ||
      codePoint == 0x85 || codePoint == 0xA0 || codePoint == 0x1680 ||
      (codePoint >= 0x2000 && codePoint <= 0x200A) ||
      (codePoint >= 0x2028 && codePoint <= 0x2029) ||
      codePoint == 0x202F || codePoint == 0x205F || codePoint == 0x3000;
  }

  function normalizeText(value) {
    value = String(value || '');
    if (!value.normalize)
      throw new Error('This browser does not support the Unicode normalization required by Electrum v2.');

    var decomposed = Array.from(value.normalize('NFKD').toLowerCase());
    var collapsed = [];
    var pendingSpace = false;

    for (var i = 0; i < decomposed.length; i++) {
      var codePoint = decomposed[i].codePointAt(0);
      if (isInRanges(codePoint, COMBINING_RANGES))
        continue;
      if (isWhitespace(codePoint)) {
        if (collapsed.length)
          pendingSpace = true;
        continue;
      }
      if (pendingSpace)
        collapsed.push(' ');
      collapsed.push(decomposed[i]);
      pendingSpace = false;
    }

    var normalized = [];
    for (var j = 0; j < collapsed.length; j++) {
      if (collapsed[j] == ' ' && j > 0 && j < collapsed.length - 1 &&
          isInRanges(collapsed[j - 1].codePointAt(0), CJK_RANGES) &&
          isInRanges(collapsed[j + 1].codePointAt(0), CJK_RANGES))
        continue;
      normalized.push(collapsed[j]);
    }
    return normalized.join('');
  }

  function seedVersion(seed) {
    return Bitcoin.Crypto.HmacSHA512(normalizeText(seed), 'Seed version').toString();
  }

  function countWords(value) {
    var characters = Array.from(String(value || ''));
    var count = 0;
    var insideWord = false;
    for (var i = 0; i < characters.length; i++) {
      if (isWhitespace(characters[i].codePointAt(0))) {
        insideWord = false;
      } else if (!insideWord) {
        count++;
        insideWord = true;
      }
    }
    return count;
  }

  function seedType(seed) {
    var numWords = countWords(seed);
    var normalized = normalizeText(seed);
    if (!normalized)
      return '';

    var version = seedVersion(normalized);
    if (version.indexOf(SEED_PREFIX_STANDARD) == 0)
      return 'standard';
    if (version.indexOf(SEED_PREFIX_SEGWIT) == 0)
      return 'segwit';
    if (version.indexOf(SEED_PREFIX_2FA) == 0 && (numWords == 12 || numWords >= 20))
      return '2fa';
    if (version.indexOf(SEED_PREFIX_2FA_SEGWIT) == 0)
      return '2fa_segwit';
    return '';
  }

  function mnemonicToSeed(seed, passphrase) {
    var password = normalizeText(seed);
    var salt = 'electrum' + normalizeText(passphrase || '');
    var wordArray = Bitcoin.Crypto.PBKDF2(password, salt, {
      keySize: 512 / 32,
      iterations: 2048,
      hasher: Bitcoin.Crypto.algo.SHA512
    });
    return Bitcoin.convert.wordArrayToBytes(wordArray);
  }

  function deriveReceivingKeys(seed, passphrase, count, useTestnet) {
    if (seedType(seed) != 'standard')
      throw new Error('Only Electrum v2 standard seeds can use the legacy P2PKH transaction engine.');

    count = parseInt(count, 10);
    if (!isFinite(count) || count < 1 || count > 1000)
      throw new Error('The number of addresses must be between 1 and 1000.');

    var root = new Bitcoin.HDWallet(
      mnemonicToSeed(seed, passphrase),
      useTestnet ? 'testnet' : 'mainnet'
    );
    var receivingChain = root.derive(0);
    var keys = [];
    for (var i = 0; i < count; i++) {
      var child = receivingChain.derive(i);
      if (!child.priv)
        throw new Error('Private-key derivation failed.');
      child.priv.compressed = true;
      keys.push(child.priv);
    }
    return keys;
  }

  return {
    normalizeText: normalizeText,
    seedVersion: seedVersion,
    seedType: seedType,
    mnemonicToSeed: mnemonicToSeed,
    deriveReceivingKeys: deriveReceivingKeys
  };
})();
