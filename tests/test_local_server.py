import unittest

from local_server import LocalBackendError, address_details, decode_base58_check


class AddressConversionTests(unittest.TestCase):
    def test_mainnet_genesis_address(self):
        version, public_key_hash = decode_base58_check("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")
        self.assertEqual(version, 0)
        self.assertEqual(public_key_hash.hex(), "62e907b15cbf27d5425399ebf6f0fb50ebb88f18")

        details = address_details("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "main")
        self.assertEqual(
            details["scriptPubKey"],
            "76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac",
        )
        self.assertEqual(len(details["scripthash"]), 64)

    def test_testnet_address_is_rejected_on_mainnet(self):
        with self.assertRaises(LocalBackendError):
            address_details("mvs4EWi862zyepMPm5wYqQC8dNnkACz5oA", "main")

    def test_bad_checksum_is_rejected(self):
        with self.assertRaises(LocalBackendError):
            decode_base58_check("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb")


if __name__ == "__main__":
    unittest.main()
