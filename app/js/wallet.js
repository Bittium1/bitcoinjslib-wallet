var WALLET = new function ()
{
  this.keys = [];
  
  // Methods
  this.textToBytes = function(text) {
    return Crypto.SHA256(text, { asBytes: true });
  };
  
  this.getKeys = function() {
    return this.keys;
  };
  
  this.getBalance = function() {

    balance = 0
		for(i = 0; i < 10; i++) {
      balance = balance + parseFloat($('#balance' + i).text()); 
    }
    return balance;
  }
  
  this.isReady = function() {
    return this.keys.length != 0;
  }
  
  this.updateAllBalances = function() {
    
    var addresses = [];
    
    for(i = 0; i < this.getKeys().length; i++)
    {
      addresses[i] = this.getKeys()[i].getBitcoinAddress().toString();
    }
		
    BLOCKCHAIN.retrieveAllBalances(addresses, function(addresses) {
			for(i = 0; i < addresses.length; i++) {
        var addr = addresses[i];
				var bal = addr.balance;
        $('#balance' + i).text(bal);  
			}
    }); 
  };
	
}
