// Local Core/Fulcrum integration with the original HelloBlock calls retained
// as fallbacks for the legacy wallet behavior.
var helloblock = new function () {
  function errorMessage(xhr, fallback) {
    if (xhr && xhr.responseJSON && xhr.responseJSON.error)
      return xhr.responseJSON.error;
    return fallback;
  }

  function retrieveHelloBlockBalances(addresses, callback, onError) {
    var query = [];
    for (var i = 0; i < addresses.length; i++)
      query.push('addresses=' + encodeURIComponent(addresses[i]));

    $.ajax({
      url: HELLOBLOCK_URL + '/v1/addresses?' + query.join('&'),
      dataType: 'json',
      success: function(res) {
        callback(res.data.addresses);
      },
      error: function(xhr) {
        if (onError) onError(errorMessage(xhr, 'HelloBlock balance lookup failed'));
      }
    });
  }

  function getHelloBlockUnspents(address, callback, onError) {
    $.ajax({
      url: HELLOBLOCK_URL + '/v1/addresses/' + encodeURIComponent(address) + '/unspents?limit=100',
      dataType: 'json',
      success: function(res) {
        callback(res.data.unspents);
      },
      error: function(xhr) {
        if (onError) onError(errorMessage(xhr, 'HelloBlock UTXO lookup failed'));
      }
    });
  }

  function sendViaHelloBlock(tx, callback, onError) {
    $.ajax({
      type: 'POST',
      url: HELLOBLOCK_URL + '/v1/transactions',
      data: {rawTxHex: tx},
      success: function(res) {
        var message = 'Transaction accepted by HelloBlock.\n';
        if (callback)
          callback(message + 'txHash: ' + res.data.transaction.txHash);
      },
      error: function(xhr) {
        var message = errorMessage(xhr, 'HelloBlock rejected the transaction');
        if (onError)
          onError(message);
        else
          alert(message);
      }
    });
  }

  this.getStatus = function(onSuccess, onError) {
    $.ajax({
      url: LOCAL_BACKEND_URL + '/status',
      dataType: 'json',
      success: onSuccess,
      error: function(xhr) {
        if (onError) onError(errorMessage(xhr, 'Local backend is unavailable'));
      }
    });
  };

  this.retrieveAllBalances = function(addresses, callback, onError) {
    var query = [];
    for (var i = 0; i < addresses.length; i++)
      query.push('addresses=' + encodeURIComponent(addresses[i]));

    $.ajax({
      url: LOCAL_BACKEND_URL + '/addresses?' + query.join('&'),
      dataType: 'json',
      success: function(res) {
        callback(res.data.addresses);
      },
      error: function() {
        retrieveHelloBlockBalances(addresses, callback, onError);
      }
    });
  };

  this.getUnspentOutputs = function(address, callback, onError) {
    $.ajax({
      url: LOCAL_BACKEND_URL + '/addresses/' + encodeURIComponent(address) + '/unspents?limit=100',
      dataType: 'json',
      success: function(res) {
        callback(res.data.unspents);
      },
      error: function() {
        getHelloBlockUnspents(address, callback, onError);
      }
    });
  };

  this.sendTX = function(tx, callback, onError) {
    $.ajax({
      type: 'POST',
      url: LOCAL_BACKEND_URL + '/transactions',
      contentType: 'application/json',
      data: JSON.stringify({rawTxHex: tx}),
      success: function(res) {
        var message = 'Transaction accepted by local Bitcoin Core.\n';
        if (callback)
          callback(message + 'txHash: ' + res.data.transaction.txHash);
      },
      error: function(xhr) {
        // Only fall back when the local bridge itself is unavailable. A Core
        // transaction rejection must not be retried through a second backend.
        if (xhr.status === 0 || xhr.status >= 500)
          sendViaHelloBlock(tx, callback, onError);
        else {
          var message = errorMessage(xhr, 'Local Bitcoin Core rejected the transaction');
          if (onError)
            onError(message);
          else
            alert(message);
        }
      }
    });
  };

  this.faucetWithdrawal = function(toAddress, value, callback) {
    $.ajax({
      type: 'POST',
      url: HELLOBLOCK_URL + '/v1/faucet/withdrawal',
      data: {value: value, toAddress: toAddress},
      success: function(res) {
        if (callback) callback(res);
      },
      error: function(xhr) {
        alert(errorMessage(xhr, 'HelloBlock faucet withdrawal failed'));
      }
    });
  };
};
