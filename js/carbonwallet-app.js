// Global, hmmm.
var walletOpening = false;
var simpleTxUtxos = [];
var simpleTxBuilt = null;
var simpleTxLoading = false;
var simpleTxRequestId = 0;

$(document).ready(function() {

  $('#site').hide();
  $('#tx').hide();
  $('#decrypt-url').hide();
  $('#your-addresses').hide();
  $('#logout-menu').hide();

  helloblock.getStatus(function(status) {
    var backendUsesTestnet = status.chain != 'main';
    if (backendUsesTestnet != !!USE_TESTNET) {
      $('#local-backend-status')
        .removeClass('alert-info')
        .addClass('alert-danger')
        .text('Local network mismatch. Reload the URL selected by the local server.');
      return;
    }

    LOCAL_BACKEND_READY = true;
    var broadcastText = status.broadcastEnabled ? 'broadcast enabled' : 'broadcast disabled';
    $('#local-backend-status')
      .removeClass('alert-info')
      .addClass('alert-success')
      .text('Local primary: Bitcoin Core ' + status.chain + ' + ' + status.electrum.server +
            ' (Electrum ' + status.electrum.protocol + ', ' + broadcastText +
            ', HelloBlock fallback)');
    checkValidPassword();
  }, function(message) {
    $('#local-backend-status')
      .removeClass('alert-info')
      .addClass('alert-danger')
      .text(message);
  });

  // Add instawallet style URLS. Only we use a hash
  // and therefore the URL is not sent to the server.
  // See http://en.wikipedia.org/wiki/Fragment_identifier
  var hash = $(location).attr('href').split('#')[1];
  if(hash != '' && hash != undefined)
  {
    $('#logon').hide();
    $('#decrypt-url').show();
  }

  $('#open-with-password').click(function(){
    var pass = $('#enc-password').val();
    var hash = $(location).attr('href').split('#')[1];

    try {
      GibberishAES.size(128);
      var dec = GibberishAES.dec(hash, pass);
      $('#password').val(mn_encode(dec));
      $('#decrypt-url').hide();
      $('#logon').show();
      checkValidPassword();
    } catch(err) {
      alert(err);
    }
  })

  $('.navbar-toggle').click(function(){
    var navigation = $('#wallet-navigation');
    var expanded = !navigation.hasClass('in');
    navigation.toggleClass('in', expanded);
    $(this).attr('aria-expanded', expanded ? 'true' : 'false');
    return false;
  });

  $('#logon form').submit(function(event) {
    event.preventDefault();
    if (!$('#open-sesame').attr('disabled'))
      $('#open-sesame').click();
    return false;
  });

  $('#open-sesame').click(function(){

    if (walletOpening || !LOCAL_BACKEND_READY)
      return false;

    var walletInput = inspectWalletInput($('#password').val());
    if (!walletInput.valid) {
      checkValidPassword();
      return false;
    }

    var seedExtension = $('#seed-extension').val() || '';
    if ((walletInput.kind == 'wif' || walletInput.seedType == 'old') && seedExtension) {
      checkValidPassword();
      return false;
    }

    walletOpening = true;
    WALLET.keys = [];
    $('#open-sesame').attr('disabled', 'disabled').val('Opening wallet...');
    $('#password-status').removeClass('text-danger text-success').text('Deriving wallet keys locally...');
    $('#create-keys').addClass('in');
    
    //clear password so people can't nab it later
    $('#password').val("");
    $('#seed-extension').val("");

    if (walletInput.kind == 'wif') {
      setTimeout(function() {
        WALLET.keys = [walletInput.wif.key];
        $('#seed-progress').css('width', '100%');
        login_success();
      }, 0);
      return true;
    }

    var seed = walletInput.seed;
    var numKeys = $('#numKeys').val();
    if (walletInput.seedType == 'old') {
      seed = mn_decode(seed);
      Electrum.init(seed, function(r) {
          if(r % 20 == 0)
            $('#seed-progress').css('width', (r + 19) + '%');
        },
        function(privKey) {
          Electrum.gen(numKeys, function(r) {
            WALLET.getKeys().push(new Bitcoin.ECKey(r[1]));
            if(WALLET.getKeys().length == numKeys)
              login_success();
          });
        }
      );
    } else {
      // Yield once so the progress message is painted before PBKDF2 runs.
      setTimeout(function() {
        try {
          WALLET.keys = ElectrumV2.deriveReceivingKeys(
            seed,
            seedExtension,
            numKeys,
            USE_TESTNET
          );
          $('#seed-progress').css('width', '100%');
          login_success();
        } catch (err) {
          walletOpenFailed('Could not derive the Electrum v2 wallet: ' + err.message);
        }
      }, 0);
    }

    return true;
  })


  $('#simpleTxForm').submit(function(event) {
    event.preventDefault();
    simpleTxBuild();
    return false;
  });
  $('#simpleTxSource').change(simpleTxLoadSource);
  $('#simpleTxDestination, #simpleTxAmount, #simpleTxFee').on('input change', invalidateSimpleTx);
  $('#simpleTxBuild').click(simpleTxBuild);
  $('#simpleTxBroadcast').click(simpleTxReviewBroadcast);
  $('#confirmBroadcast').click(simpleTxBroadcast);

  $('#password, #seed-extension').on('input change', checkValidPassword);

  $('#generate-password').click(generatePassword);
  $('#regenerate-password').click(regeneratePassword);
  $('#regenerate-password').tooltip({container: 'body'});

  //advanced settings
  if (qs('advanced')){
    $('#advanced').addClass("in");
  }

  $('#numKeys').tooltip();

  //network button group
  if (USE_TESTNET){
    $('#testnet').addClass("active");
  }else{
    $('#bitcoin').addClass("active");
  }


  $('#your-addresses-nav, #home').click(showAddresses);


  $('#make-payment-nav').click(function(){
    hideAll();
    $('#tx').show();
    $('#make-payment-nav').parent().addClass('current');
    return false;
  });

  $('#your-dashboard-nav').click(function(){
    hideAll();
    $('#dashboard').show();
    $('#your-dashboard-nav').parent().addClass('current');
    return false;
  });

  $('#logout').click(function(){
    simpleTxRequestId++;
    simpleTxLoading = false;
    simpleTxUtxos = [];
    resetSimpleTxPreview();
    $('#simpleTxSource').empty();
    $('#simpleTxDestination, #simpleTxAmount').val('');
    $('#simpleTxBalance').val('0.00000000');
    WALLET.keys = [];
    $('#password').val('');
    $('#seed-extension').val('');
    $('#site').hide();
    $('#create-keys').collapse('hide');
    $('#create-WALLET').collapse('hide');
    $('#logout-menu').hide();
    checkValidPassword();
    $('#logon').show();
    return false;
  });

  $('#gen-link').click(function() {
    var passphrase = $('#password').val();

    // Convert it to hex as it's smaller.
    var dec = mn_decode(passphrase);
    var pass = $('#link-password').val();
    GibberishAES.size(128);
    var key = GibberishAES.enc(dec, pass)
    $('#link-text').text(location.origin + location.pathname + location.search + '#' + key);
    return false;
  });

  function faucetWithdrawal() {

    var faucetButton = $('#faucet')

    if (faucetButton.attr('disabled')) return;

    faucetButton.attr('disabled', 'disabled');
    WALLET.faucetWithdrawal( function() {
      WALLET.updateAllBalances();
      simpleTxLoadSource();
      
      if (WALLET.withdrawals)
        faucetButton.removeAttr('disabled');
      else
        faucetButton.hide();
    });
  }

  function showAddresses() {
    hideAll();
    $('#your-addresses').show();
    $('#your-addresses-nav').parent().addClass('current');
    return false;
  };

  function alertModal(text) {
    $('#alertModalText').text(text || 'Nevermind');
    $('#alertModal').modal();
  }

  function hideAll()
  {
    $('ul.side-menu li').removeClass('current');
    $('#your-addresses').hide();
    $('#tx').hide();
    $('#dashboard').hide();
  }

  function login_success()
  {
    walletOpening = false;
    $('#open-sesame').val('Open Wallet');
    $('#logon').hide();
    $('#site').show();
    $('#logout-menu').show();

    if ($(window).width() < 992) {
      $('#wallet-navigation').addClass('in');
      $('.navbar-toggle').attr('aria-expanded', 'true');
    }

    WALLET.updateAllBalances();

    $(".public-addresses tbody").empty();
    $("#simpleTxSource").find("option").remove();

    for(i = 0; i < WALLET.getKeys().length; i++)
    {
      
      $(".public-addresses tbody").append(makeAddressRow(i));

      var addr = WALLET.getKeys()[i].getAddress(NETWORK_VERSION).toString();
      $('#address' + i).text(addr);
      $("#simpleTxSource").append('<option value="' + i + '"></option>');
      $("#simpleTxSource option:last").text(addr);
      var qrcode = makeQRCode(addr);
      $('#qrcode' + i).popover({ title: 'QRCode', html: true, content: qrcode, placement: 'bottom' });
    }

    simpleTxLoadSource();

    $(document).trigger('wallet:ready');

    $('#faucet').click(faucetWithdrawal);

    return false;
  }

  function walletOpenFailed(message) {
    walletOpening = false;
    WALLET.keys = [];
    $('#seed-progress').css('width', '0%');
    $('#create-keys').removeClass('in');
    $('#open-sesame').attr('disabled', 'disabled').removeClass('btn-primary').val('Open Wallet');
    $('#password-status').removeClass('text-success').addClass('text-danger').text(message);
  }

  function makeAddressRow(i){
    //this should use a template engine or something, but we don't have one. 
    //We could also rework this to clone a sample TR if we want to keep the layout in app.html
    row = '<tr><td><code id="address'+i+'"></code></td> \
           <td><span><strong id="balance'+i+'"> </strong></span></td> \
           <td><i id="qrcode'+i+'" class="btn btn-default fa fa-qrcode"></i>';
            if (i==0 && USE_TESTNET){//add faucet
              row += ' <input type="button" id="faucet" class="btn btn-default" style="width: 94px;" value="add coins">';
            }
    row += '</td></tr>';
    return row;
  }

  function makeQRCode(addr) {
    var qr = qrcode(3, 'M');
    addr = addr.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
    qr.addData(addr);
    qr.make();
    return qr.createImgTag(4);
  }

  function normalizeSeed(seed) {
    return ElectrumV2.normalizeText(seed || '');
  }

  function isValidLegacySeed(seed) {
    var words = normalizeSeed(seed).split(' ');
    if (words.length != 12)
      return false;

    for (var i = 0; i < words.length; i++) {
      if (mn_words.indexOf(words[i]) == -1)
        return false;
    }
    return true;
  }

  function detectSeedType(seed) {
    if (isValidLegacySeed(seed))
      return 'old';
    return ElectrumV2.seedType(seed);
  }

  function isSupportedSeedType(seedType) {
    return seedType == 'old' || seedType == 'standard';
  }

  function trimWalletInput(value) {
    return String(value || '').replace(/^\s+|\s+$/g, '');
  }

  function inspectWalletInput(value) {
    var raw = trimWalletInput(value);
    if (WifPrivateKey.isCandidate(raw)) {
      var wif = WifPrivateKey.parse(raw, USE_TESTNET);
      return {
        kind: 'wif',
        valid: wif.valid,
        wif: wif,
        raw: raw
      };
    }

    var seed = normalizeSeed(raw);
    var seedType = seed ? detectSeedType(seed) : '';
    return {
      kind: 'seed',
      valid: isSupportedSeedType(seedType),
      seed: seed,
      seedType: seedType,
      raw: raw
    };
  }

  function checkValidPassword(){
    if (walletOpening)
      return;

    var walletInput = inspectWalletInput($('#password').val());
    var seedExtension = $('#seed-extension').val() || '';
    var extensionNotAllowed = seedExtension &&
      (walletInput.kind == 'wif' || walletInput.seedType == 'old');
    var valid = walletInput.valid && !extensionNotAllowed;

    if (walletInput.kind == 'wif')
      $('#numKeys').attr('disabled', 'disabled');
    else
      $('#numKeys').removeAttr('disabled');

    if(valid && LOCAL_BACKEND_READY)
    {
      $('#open-sesame').addClass('btn-primary');
      $('#open-sesame').removeAttr('disabled');
      if (walletInput.kind == 'wif')
        $('#password-status').removeClass('text-danger').addClass('text-success').text(
          'Valid ' + walletInput.wif.network + ' WIF private key (' +
          (walletInput.wif.compressed ? 'compressed' : 'uncompressed') +
          ' P2PKH). One address will be opened.'
        );
      else if (walletInput.seedType == 'old')
        $('#password-status').removeClass('text-danger').addClass('text-success').text('Valid legacy Electrum v1 seed. Ready to open.');
      else if (seedExtension)
        $('#password-status').removeClass('text-danger').addClass('text-success').text('Valid Electrum v2 standard seed. The seed extension will be applied locally.');
      else
        $('#password-status').removeClass('text-danger').addClass('text-success').text('Valid Electrum v2 standard seed (legacy P2PKH). Ready to open.');
    }
    else
    {
      $('#open-sesame').removeClass('btn-primary');
      $('#open-sesame').attr('disabled', 'disabled');
      $('#password-status').removeClass('text-success').addClass('text-danger');
      if (!LOCAL_BACKEND_READY)
        $('#password-status').text('Waiting for the local backend...');
      else if (!walletInput.raw)
        $('#password-status').text('Enter an Electrum v1/v2 standard seed or one WIF private key.');
      else if (walletInput.kind == 'wif' && walletInput.valid && seedExtension)
        $('#password-status').text('A seed extension cannot be used with a WIF private key. Clear the extension to continue.');
      else if (walletInput.kind == 'wif')
        $('#password-status').text(walletInput.wif.message);
      else if (walletInput.seedType == 'old' && seedExtension)
        $('#password-status').text('Legacy Electrum v1 seeds cannot use a seed extension. Clear the extension to continue.');
      else if (walletInput.seedType == 'segwit')
        $('#password-status').text('Electrum v2 SegWit seed recognized, but this legacy transaction engine cannot safely spend from SegWit addresses yet.');
      else if (walletInput.seedType == '2fa' || walletInput.seedType == '2fa_segwit')
        $('#password-status').text('Electrum v2 two-factor seed recognized, but 2FA wallets are not supported.');
      else
        $('#password-status').text('Not a supported Electrum v1 or v2 standard seed. BIP39 seeds are not supported by this wallet.');
    }
  }

  // -- WALLET Creation --
  function regeneratePassword() {
    $('#generated').val('');
    return generatePassword();
  }

  function generatePassword() {

    $('#generated').focus();

    if($('#generated').val() != '')
      return true;

    var pk = secureRandom(32, { array: true })
    var seed = Bitcoin.convert.bytesToHex(pk.slice(0,16));
    //nb! electrum doesn't handle trailing zeros very well
    // and we want to stay compatible.
    if (seed.charAt(0) == '0') seed = seed.substr(1);
    var codes = mn_encode(seed);
    $('#generated').val(codes);

    return true;
  }

  // -- simple transaction builder --

  function simpleTxSetStatus(level, message) {
    $('#simpleTxStatus')
      .removeClass('alert-info alert-success alert-danger alert-warning')
      .addClass('alert-' + level)
      .text(message);
  }

  function resetSimpleTxPreview() {
    simpleTxBuilt = null;
    $('#simpleTxHex').val('');
    $('#simpleTxPreview').hide();
    $('#simpleTxBroadcast').attr('disabled', 'disabled');
  }

  function invalidateSimpleTx() {
    if (simpleTxBuilt)
      simpleTxSetStatus('info', 'Transaction details changed. Build and sign again to review them.');
    resetSimpleTxPreview();
  }

  function simpleTxLoadSource() {
    var keyIndex = parseInt($('#simpleTxSource').val(), 10);
    var key = WALLET.getKeys()[keyIndex];
    var requestId = ++simpleTxRequestId;

    simpleTxUtxos = [];
    simpleTxLoading = false;
    resetSimpleTxPreview();
    $('#simpleTxBalance').val('0.00000000');
    $('#simpleTxBuild').attr('disabled', 'disabled');

    if (!key) {
      simpleTxSetStatus('danger', 'Select a wallet source address.');
      return false;
    }

    var address = key.getAddress(NETWORK_VERSION).toString();
    simpleTxLoading = true;
    simpleTxSetStatus('info', 'Loading spendable outputs for the selected address...');

    helloblock.getUnspentOutputs(address, function(unspents) {
      if (requestId != simpleTxRequestId)
        return;

      try {
        var normalized = SimpleTransactionBuilder.normalizeUtxos(
          unspents,
          address,
          USE_TESTNET
        );
        var balance = 0;
        normalized.forEach(function(utxo) {
          balance += utxo.value;
          if (!Number.isSafeInteger(balance))
            throw new Error('The spendable balance is too large.');
        });

        simpleTxUtxos = unspents.slice();
        simpleTxLoading = false;
        $('#simpleTxBalance').val(SimpleTransactionBuilder.formatBtc(balance));

        if (normalized.length) {
          $('#simpleTxBuild').removeAttr('disabled');
          simpleTxSetStatus(
            'success',
            'Loaded ' + normalized.length + ' spendable output' +
              (normalized.length == 1 ? '' : 's') + '. Building remains local.'
          );
        } else {
          simpleTxSetStatus('warning', 'No spendable outputs were found for this address.');
        }
      } catch (err) {
        simpleTxLoading = false;
        simpleTxUtxos = [];
        simpleTxSetStatus('danger', 'Could not use the returned outputs: ' + err.message);
      }
    }, function(message) {
      if (requestId != simpleTxRequestId)
        return;
      simpleTxLoading = false;
      simpleTxUtxos = [];
      simpleTxSetStatus('danger', message || 'Could not load spendable outputs.');
    });
    return false;
  }

  function simpleTxBuild() {
    if (simpleTxLoading)
      return false;

    var keyIndex = parseInt($('#simpleTxSource').val(), 10);
    var key = WALLET.getKeys()[keyIndex];
    resetSimpleTxPreview();

    try {
      simpleTxBuilt = SimpleTransactionBuilder.build({
        key: key,
        utxos: simpleTxUtxos,
        destination: $('#simpleTxDestination').val(),
        amountBtc: $('#simpleTxAmount').val(),
        feeBtc: $('#simpleTxFee').val(),
        useTestnet: USE_TESTNET
      });

      $('#simpleTxInputCount').text(simpleTxBuilt.selectedInputCount);
      $('#simpleTxPreviewAmount').text(SimpleTransactionBuilder.formatBtc(simpleTxBuilt.amountSats));
      $('#simpleTxPreviewFee').text(SimpleTransactionBuilder.formatBtc(simpleTxBuilt.actualFeeSats));
      $('#simpleTxPreviewChange').text(SimpleTransactionBuilder.formatBtc(simpleTxBuilt.changeSats));
      $('#simpleTxHex').val(simpleTxBuilt.rawHex);
      $('#simpleTxPreview').show();
      $('#simpleTxBroadcast').removeAttr('disabled');
      simpleTxSetStatus('success', 'Signed raw transaction built locally. Nothing has been broadcast.');
    } catch (err) {
      simpleTxBuilt = null;
      simpleTxSetStatus('danger', err.message || String(err));
    }
    return false;
  }

  function simpleTxReviewBroadcast() {
    if (!simpleTxBuilt)
      return false;

    $('#broadcastDestination').text(simpleTxBuilt.destinationAddress);
    $('#broadcastAmount').text(SimpleTransactionBuilder.formatBtc(simpleTxBuilt.amountSats));
    $('#broadcastFee').text(SimpleTransactionBuilder.formatBtc(simpleTxBuilt.actualFeeSats));
    $('#confirmBroadcast').removeAttr('disabled').text('Broadcast transaction');
    $('#broadcastModal').modal();
    return false;
  }

  function simpleTxBroadcast() {
    if (!simpleTxBuilt)
      return false;

    var rawHex = simpleTxBuilt.rawHex;
    $('#confirmBroadcast').attr('disabled', 'disabled').text('Broadcasting...');
    simpleTxSetStatus('info', 'Broadcasting the signed transaction...');

    helloblock.sendTX(rawHex, function(message) {
      $('#broadcastModal').modal('hide');
      $('#confirmBroadcast').removeAttr('disabled').text('Broadcast transaction');
      alertModal(message || 'Transaction broadcast completed.');
      $('#simpleTxDestination').val('');
      $('#simpleTxAmount').val('');
      resetSimpleTxPreview();
      WALLET.updateAllBalances();
      simpleTxLoadSource();
    }, function(message) {
      $('#broadcastModal').modal('hide');
      $('#confirmBroadcast').removeAttr('disabled').text('Broadcast transaction');
      simpleTxSetStatus('danger', message || 'The transaction broadcast failed.');
      alertModal(message || 'The transaction broadcast failed.');
    });
    return false;
  }
});
