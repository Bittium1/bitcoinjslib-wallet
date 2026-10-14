#!/usr/bin/env python3
"""Loopback-only web and API server for the legacy bitcoinjslib wallet.

Address state is read from a local Electrum server (Fulcrum/electrs), while
Bitcoin Core supplies chain identity and, only when explicitly enabled,
transaction broadcast. No RPC credential is exposed to the browser.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit


BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BASE58_INDEX = {character: index for index, character in enumerate(BASE58_ALPHABET)}
CHAIN_ADDRESS_VERSION = {"main": 0x00, "test": 0x6F, "signet": 0x6F, "regtest": 0x6F}


class LocalBackendError(RuntimeError):
    """An error safe to summarize to the local browser."""


def decode_base58_check(address: str) -> tuple[int, bytes]:
    if not address or any(character not in BASE58_INDEX for character in address):
        raise LocalBackendError("Invalid Base58Check address")

    number = 0
    for character in address:
        number = number * 58 + BASE58_INDEX[character]

    raw = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    raw = b"\x00" * (len(address) - len(address.lstrip("1"))) + raw
    if len(raw) != 25:
        raise LocalBackendError("Only legacy P2PKH addresses are supported")

    payload, checksum = raw[:-4], raw[-4:]
    expected = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    if checksum != expected:
        raise LocalBackendError("Invalid Base58Check checksum")
    if len(payload) != 21:
        raise LocalBackendError("Invalid P2PKH payload")
    return payload[0], payload[1:]


def address_details(address: str, chain: str) -> dict[str, str]:
    expected_version = CHAIN_ADDRESS_VERSION.get(chain)
    if expected_version is None:
        raise LocalBackendError(f"Unsupported Bitcoin Core chain: {chain}")

    version, public_key_hash = decode_base58_check(address)
    if version != expected_version:
        raise LocalBackendError(f"Address does not belong to the local {chain} chain")

    script = b"\x76\xa9\x14" + public_key_hash + b"\x88\xac"
    electrum_scripthash = hashlib.sha256(script).digest()[::-1].hex()
    return {
        "address": address,
        "hash160": public_key_hash.hex(),
        "scriptPubKey": script.hex(),
        "scripthash": electrum_scripthash,
    }


def ensure_loopback(host: str) -> None:
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as error:
        raise LocalBackendError(f"Cannot resolve Electrum host: {host}") from error

    if not addresses or any(not ipaddress.ip_address(address).is_loopback for address in addresses):
        raise LocalBackendError("Electrum host must resolve only to a loopback address")


class ElectrumClient:
    def __init__(self, host: str, port: int, timeout: float = 10.0) -> None:
        ensure_loopback(host)
        self.host = host
        self.port = port
        self.timeout = timeout

    def request_many(self, calls: list[tuple[str, list[object]]]) -> list[object]:
        if not calls:
            return []

        requests = [
            {"jsonrpc": "2.0", "id": index, "method": method, "params": params}
            for index, (method, params) in enumerate(calls, start=1)
        ]
        responses: dict[int, object] = {}

        try:
            with socket.create_connection((self.host, self.port), timeout=self.timeout) as connection:
                connection.settimeout(self.timeout)
                with connection.makefile("rwb") as stream:
                    for request in requests:
                        stream.write(json.dumps(request, separators=(",", ":")).encode("utf-8") + b"\n")
                    stream.flush()

                    while len(responses) < len(requests):
                        line = stream.readline()
                        if not line:
                            raise LocalBackendError("Local Electrum server closed the connection")
                        response = json.loads(line.decode("utf-8"))
                        response_id = response.get("id")
                        if response_id is None:
                            continue
                        if response.get("error"):
                            message = response["error"].get("message", "Electrum request failed")
                            raise LocalBackendError(str(message))
                        responses[int(response_id)] = response.get("result")
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise LocalBackendError("Local Electrum server is unavailable") from error

        return [responses[index] for index in range(1, len(requests) + 1)]

    def request(self, method: str, params: list[object] | None = None) -> object:
        return self.request_many([(method, params or [])])[0]


class BitcoinCoreCLI:
    def __init__(self, executable: str, datadir: str) -> None:
        self.executable = executable
        self.datadir = datadir

    def _run(self, *arguments: str, timeout: float = 15.0) -> str:
        command = [
            self.executable,
            f"-datadir={self.datadir}",
            "-rpcconnect=127.0.0.1",
            *arguments,
        ]
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                creationflags=creation_flags,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise LocalBackendError("Local Bitcoin Core RPC is unavailable") from error

        if result.returncode != 0:
            raise LocalBackendError("Local Bitcoin Core RPC rejected the request")
        return result.stdout.strip()

    def blockchain_info(self) -> dict[str, object]:
        try:
            return json.loads(self._run("getblockchaininfo"))
        except json.JSONDecodeError as error:
            raise LocalBackendError("Bitcoin Core returned invalid JSON") from error

    def genesis_hash(self) -> str:
        return self._run("getblockhash", "0")

    def send_raw_transaction(self, raw_transaction: str) -> str:
        return self._run("sendrawtransaction", raw_transaction, timeout=30.0)


class LocalWalletHTTPServer(ThreadingHTTPServer):
    electrum: ElectrumClient
    core: BitcoinCoreCLI
    chain: str
    core_genesis_hash: str
    electrum_features: dict[str, object]
    electrum_version: list[object]
    broadcast_enabled: bool


class LocalWalletHandler(SimpleHTTPRequestHandler):
    server_version = "BitcoinjslibLocal/1.0"

    @property
    def wallet_server(self) -> LocalWalletHTTPServer:
        return self.server  # type: ignore[return-value]

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        script_sources = "'self' 'unsafe-eval'" if urlsplit(self.path).path == "/SpecRunner.html" else "'self'"
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; connect-src 'self' https://mainnet.helloblock.io "
            "https://testnet.helloblock.io https://blockchain.info; img-src 'self' data:; "
            f"style-src 'self' 'unsafe-inline'; script-src {script_sources}",
        )
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def _valid_host(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].lower()
        return host in {"127.0.0.1", "localhost"}

    def _json_response(self, status: HTTPStatus, payload: object) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error_response(self, status: HTTPStatus, message: str) -> None:
        self._json_response(status, {"error": message})

    def _redirect_network_if_needed(self, parsed_url) -> bool:
        if parsed_url.path not in {"/", "/app.html"}:
            return False

        query = parse_qs(parsed_url.query, keep_blank_values=True)
        local_testnet = self.wallet_server.chain != "main"
        requested_testnet = query.get("testnet", ["0"])[0] not in {"", "0"}
        if parsed_url.path == "/app.html" and requested_testnet == local_testnet:
            return False

        query["testnet"] = ["1" if local_testnet else "0"]
        flattened = [(key, value) for key, values in query.items() for value in values]
        location = "/app.html?" + urlencode(flattened)
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.end_headers()
        return True

    @staticmethod
    def _static_path_allowed(path: str) -> bool:
        if path in {"/app.html", "/SpecRunner.html"}:
            return True
        return path.startswith(("/css/", "/extjs/", "/js/", "/lib/", "/spec/", "/assets/"))

    def do_GET(self) -> None:
        if not self._valid_host():
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid Host header")
            return

        parsed_url = urlsplit(self.path)
        if self._redirect_network_if_needed(parsed_url):
            return

        try:
            if parsed_url.path == "/api/status":
                self._handle_status()
                return
            if parsed_url.path == "/api/addresses":
                self._handle_addresses(parse_qs(parsed_url.query).get("addresses", []))
                return
            if parsed_url.path.startswith("/api/addresses/") and parsed_url.path.endswith("/unspents"):
                address = parsed_url.path[len("/api/addresses/") : -len("/unspents")].strip("/")
                limit_text = parse_qs(parsed_url.query).get("limit", ["100"])[0]
                try:
                    limit = int(limit_text)
                except ValueError as error:
                    raise LocalBackendError("Invalid UTXO limit") from error
                self._handle_unspents(address, limit)
                return
            if parsed_url.path.startswith("/api/"):
                self._error_response(HTTPStatus.NOT_FOUND, "Unknown local API route")
                return
        except LocalBackendError as error:
            self._error_response(HTTPStatus.BAD_GATEWAY, str(error))
            return

        if not self._static_path_allowed(parsed_url.path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if not self._valid_host():
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid Host header")
            return
        parsed_url = urlsplit(self.path)
        if not self._static_path_allowed(parsed_url.path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        if not self._valid_host():
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid Host header")
            return

        origin = self.headers.get("Origin", "")
        allowed_origins = {
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        }
        if origin not in allowed_origins:
            self._error_response(HTTPStatus.FORBIDDEN, "Cross-origin requests are not allowed")
            return
        if self.headers.get_content_type() != "application/json":
            self._error_response(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "JSON request required")
            return

        parsed_url = urlsplit(self.path)
        if parsed_url.path != "/api/transactions":
            self._error_response(HTTPStatus.NOT_FOUND, "Unknown local API route")
            return
        if not self.wallet_server.broadcast_enabled:
            self._error_response(HTTPStatus.FORBIDDEN, "Transaction broadcast is disabled on the local server")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1_000_000:
                raise LocalBackendError("Invalid request size")
            request = json.loads(self.rfile.read(length).decode("utf-8"))
            raw_transaction = request.get("rawTxHex", "")
            if not isinstance(raw_transaction, str) or not raw_transaction or any(
                character not in "0123456789abcdefABCDEF" for character in raw_transaction
            ):
                raise LocalBackendError("Invalid raw transaction")
            transaction_id = self.wallet_server.core.send_raw_transaction(raw_transaction)
            self._json_response(
                HTTPStatus.OK,
                {"data": {"transaction": {"txHash": transaction_id}}},
            )
        except (LocalBackendError, ValueError, json.JSONDecodeError) as error:
            message = str(error) if isinstance(error, LocalBackendError) else "Invalid JSON request"
            self._error_response(HTTPStatus.BAD_REQUEST, message)

    def _handle_status(self) -> None:
        core_info = self.wallet_server.core.blockchain_info()
        self._json_response(
            HTTPStatus.OK,
            {
                "mode": "local-primary",
                "chain": self.wallet_server.chain,
                "broadcastEnabled": self.wallet_server.broadcast_enabled,
                "core": {
                    "blocks": core_info.get("blocks"),
                    "headers": core_info.get("headers"),
                    "initialBlockDownload": core_info.get("initialblockdownload"),
                    "verificationProgress": core_info.get("verificationprogress"),
                },
                "electrum": {
                    "server": self.wallet_server.electrum_version[0],
                    "protocol": self.wallet_server.electrum_version[1],
                },
            },
        )

    def _handle_addresses(self, addresses: list[str]) -> None:
        if not addresses or len(addresses) > 50:
            raise LocalBackendError("Provide between 1 and 50 addresses")

        details = [address_details(address, self.wallet_server.chain) for address in addresses]
        balances = self.wallet_server.electrum.request_many(
            [("blockchain.scripthash.get_balance", [detail["scripthash"]]) for detail in details]
        )
        response = []
        for detail, balance in zip(details, balances, strict=True):
            confirmed = int(balance.get("confirmed", 0))
            unconfirmed = int(balance.get("unconfirmed", 0))
            response.append(
                {
                    "address": detail["address"],
                    "balance": confirmed + unconfirmed,
                    "confirmedBalance": confirmed,
                    "unconfirmedBalance": unconfirmed,
                }
            )
        self._json_response(HTTPStatus.OK, {"data": {"addresses": response}})

    def _handle_unspents(self, address: str, limit: int) -> None:
        if limit < 1 or limit > 500:
            raise LocalBackendError("UTXO limit must be between 1 and 500")
        detail = address_details(address, self.wallet_server.chain)
        tip = self.wallet_server.electrum.request("blockchain.headers.subscribe")
        outputs = self.wallet_server.electrum.request(
            "blockchain.scripthash.listunspent", [detail["scripthash"]]
        )
        tip_height = int(tip.get("height", 0))
        unspents = []
        selected_outputs = sorted(
            outputs,
            key=lambda output: (int(output.get("value", 0)), int(output.get("height", 0))),
            reverse=True,
        )[:limit]
        for output in selected_outputs:
            height = int(output.get("height", 0))
            confirmations = tip_height - height + 1 if height > 0 else 0
            unspents.append(
                {
                    "confirmations": confirmations,
                    "blockHeight": height,
                    "txHash": output["tx_hash"],
                    "index": int(output["tx_pos"]),
                    "scriptPubKey": detail["scriptPubKey"],
                    "type": "pubkeyhash",
                    "value": int(output["value"]),
                    "hash160": detail["hash160"],
                    "address": address,
                }
            )
        self._json_response(HTTPStatus.OK, {"data": {"unspents": unspents}})


def default_bitcoin_cli() -> str:
    configured = shutil.which("bitcoin-cli")
    if configured:
        return configured
    return r"C:\Program Files\Bitcoin\daemon\bitcoin-cli.exe"


def parse_arguments() -> argparse.Namespace:
    local_app_data = os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))
    parser = argparse.ArgumentParser(description="Run the wallet against local Core and Electrum only")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--electrum-host", default="127.0.0.1")
    parser.add_argument("--electrum-port", type=int, default=50001)
    parser.add_argument("--bitcoin-cli", default=default_bitcoin_cli())
    parser.add_argument("--datadir", default=str(Path(local_app_data) / "Bitcoin"))
    parser.add_argument(
        "--disable-broadcast",
        action="store_true",
        help="Disable submission of signed transactions to local Bitcoin Core",
    )
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    root = Path(__file__).resolve().parent
    electrum = ElectrumClient(arguments.electrum_host, arguments.electrum_port)
    core = BitcoinCoreCLI(arguments.bitcoin_cli, arguments.datadir)

    try:
        core_info = core.blockchain_info()
        chain = str(core_info["chain"])
        core_genesis_hash = core.genesis_hash()
        electrum_version = electrum.request("server.version", ["bitcoinjslib-wallet-local", "1.4"])
        electrum_features = electrum.request("server.features")
        if electrum_features.get("genesis_hash") != core_genesis_hash:
            raise LocalBackendError("Bitcoin Core and Electrum are on different chains")
        if chain not in CHAIN_ADDRESS_VERSION:
            raise LocalBackendError(f"Unsupported Bitcoin Core chain: {chain}")
    except (KeyError, LocalBackendError) as error:
        print(f"Startup failed: {error}", file=sys.stderr)
        return 1

    def handler(*args, **kwargs):
        return LocalWalletHandler(*args, directory=str(root), **kwargs)

    server = LocalWalletHTTPServer(("127.0.0.1", arguments.port), handler)
    server.electrum = electrum
    server.core = core
    server.chain = chain
    server.core_genesis_hash = core_genesis_hash
    server.electrum_features = electrum_features
    server.electrum_version = electrum_version
    server.broadcast_enabled = not arguments.disable_broadcast

    print(
        f"Local wallet server: http://127.0.0.1:{arguments.port}/app.html "
        f"(chain={chain}, broadcast={'enabled' if server.broadcast_enabled else 'disabled'})",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
