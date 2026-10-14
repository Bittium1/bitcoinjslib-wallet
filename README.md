## Project
SF Bitcoindev build a deterministic wallet forked from Carbon Wallet. It can
run through the loopback web server or as a packaged Electron desktop app.


## Features
- Web based wallet
- BIP 32 Deterministic keys
- Uses Bitcoinjs-lib v0.20
- Testnet Switch with seeded bitcoin
- Uses Helloblock.js for testnet faucet
- A ChromeApp developer kit
- Opens legacy Electrum v1 seeds and Electrum v2 standard (P2PKH) seeds
- Opens a single-address P2PKH wallet from a checksummed WIF private key
- Builds and signs simple legacy P2PKH transactions locally before an optional, separately confirmed broadcast
- Packages as a Windows desktop installer/ZIP or a macOS app/DMG

## Desktop application

The Electron app contains its own loopback-only HTTP/API server, so packaged
builds do not require Python. Bitcoin Core and Fulcrum/electrs must still be
running locally and must use the same chain. The renderer has no Node.js
access; RPC credentials, cookies, seeds, WIFs, and private keys are not exposed
to the desktop main process.

On Windows, run the generated `SF Bitcoin Devs Wallet-0.1.0 Setup.exe`, or
extract the ZIP and launch `sf-bitcoin-devs-wallet.exe`. The app searches for
Bitcoin Core in `PATH` and then in the normal Bitcoin Core installation
location. On macOS it checks Homebrew and Bitcoin Core application locations.

At first start, the app creates a non-secret `wallet-config.json` file here:

- Windows: `%APPDATA%\SF Bitcoin Devs Wallet\wallet-config.json`
- macOS: `~/Library/Application Support/SF Bitcoin Devs Wallet/wallet-config.json`

The supported settings are `bitcoinCli`, `bitcoinDataDir`, `electrumHost`,
`electrumPort`, `port`, and `broadcastEnabled`. The Electrum host must resolve
only to loopback. Broadcast is enabled by default and still requires the
wallet's explicit confirmation dialog.

Build commands:

```text
pnpm install
pnpm run start
pnpm run make:windows
pnpm run make:mac
```

Windows installers must be built on Windows, and macOS DMG files must be built
on macOS. Publicly distributed builds should be code-signed; unsigned local
builds can trigger Windows SmartScreen or macOS Gatekeeper warnings.

## Local-only usage
This fork is intended to use a Bitcoin Core node and an Electrum-protocol
server (Fulcrum/electrs) running on the same computer. Local Core and Electrum
are primary; the legacy HelloBlock calls remain as fallbacks, and the dashboard
retains its blockchain.info price request.

1. Start Bitcoin Core with RPC enabled.
2. Start a local Electrum server on `127.0.0.1:50001` backed by the same chain.
3. Run `python local_server.py`.
4. Open `http://127.0.0.1:8765/app.html`.

The server detects the local Core chain and redirects the browser to the
matching mainnet/testnet URL. Transaction broadcast through local Bitcoin Core
is enabled by default. Use `python local_server.py --disable-broadcast` for a
read-only session.

Electrum v2 standard seeds use Electrum's native seed-version check,
PBKDF2-HMAC-SHA512 derivation, optional seed extension, and the `m/0/i`
receiving path. Electrum v2 SegWit and two-factor seeds are detected but are
not opened because this wallet's legacy transaction engine cannot safely
construct and sign those transactions. BIP39 seeds are not accepted.

The wallet also accepts one Wallet Import Format (WIF) private key. It checks
the Base58Check checksum, mainnet/testnet version, compression marker, payload
length, and secp256k1 range before opening the corresponding single P2PKH
address. Raw hexadecimal private keys are deliberately not accepted.

The Transaction Builder uses exact satoshi arithmetic, validates the selected
network and source UTXO scripts, accepts one legacy P2PKH or P2SH destination,
selects inputs deterministically, and returns change to the source address.
Change below 546 satoshis is added to the fee instead of creating a dust
output. Building only produces a signed raw transaction in the browser;
broadcast remains a separate action with an explicit confirmation dialog.


### Specs: It's easy and helps keep the project running!
1. Put them in the /spec dir
2. Run them after making a change:

    `open SpecRunner.html`

Desktop backend tests run with:

    `pnpm run test:desktop`


## Security Warnings
This software is alpha software. Use it only on a clean, trusted computer and
do not use it with production funds without an independent security review.


## Authors
* [Sidney Zhang](https://github.com/sidazhang)
* [Larry Kang](https://github.com/lkang)
* [Srinivasan Sriram](https://github.com/ssr1ram)
* [Karl Keefer](https://github.com/karlkeefer)
* [Vladimir Pekez](https://github.com/vladimirpekez/)
* [Taariq Lewis](https://github.com/taariq)


## Contributing
Feel free to send pull requests to have your project/startup listed here.

## Special Thanks
Special thanks to the [Carbon Wallet](http://carbonwallet.com/) team that inspired this project fork.

## License
This web wallet is free and open-source software released under the MIT license.
