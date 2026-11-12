# Contracts

The game deploys two standard contracts. It adds no contract code of its own: what is new in Emberwick is
the economy and the agents around them, not the contracts.

| File | What it is | Source it comes from | Code hash on NEAR (base58 SHA-256 of the file) |
|---|---|---|---|
| `emwk_token.wasm` | NEP-141 fungible token (EMWK), NEP-297 events | the `fungible-token` example of [near-sdk-rs](https://github.com/near/near-sdk-rs) 4.0 | `HVqQf5j47gTep7X4oPft8DVXYaPt6K9A1AXZpkGrT9Lo` |
| `emwk_deeds.wasm` | NEP-171 non-fungible token (land deeds) | the `non-fungible-token` example of near-sdk-rs 4.0 | `6inQQWn3RbpjjRcyiJa3Qgb7Z6YDqC1yEQYgZTiJe4UJ` |

**Check that the deployed contract is this file.** NEAR keeps the SHA-256 of every account's code. Ask for it and
compare it with the last column:

```bash
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"token.emberwick-village.testnet"}}' | grep -o '"code_hash":"[^"]*"'
```

(The deeds contract is `deeds.emberwick-village.testnet`; the online demo uses `emwk.emberwick-village-2.testnet` and `deeds.emberwick-village-2.testnet`.)
To hash the file yourself: `node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('contracts/emwk_token.wasm')).digest('hex'))"` gives the same hash in hex.

**Building from source.** The examples build with `cargo near build` in their folders of the near-sdk-rs repository at
its 4.0 release. A build with a different Rust toolchain does not give a byte-identical file, so the hash above is the
way to tie the deployed code to this repository. The contracts have not had a separate audit; no mainnet value sits in them.
