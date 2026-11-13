# Contracts

The game uses three contracts: two standard ones, and one of its own.

| File | What it is | Source | Code hash on NEAR (base58 SHA-256 of the file) |
|---|---|---|---|
| `emwk_ledger.wasm` | **Village Ledger, written for Emberwick**: an append-only record of each day's village-state hash and NEAR AI plan hash (model, TEE report, signature check) | [`village-ledger/`](village-ledger/) in this repository (Rust, near-sdk 5.30, 7 unit tests) | `6HMoJcDsHVuMcW7g9h9DdSskauXFSfz8qqCHc77DcoJd` |
| `emwk_token.wasm` | NEP-141 fungible token (EMWK), NEP-297 events | the `fungible-token` example of [near-sdk-rs](https://github.com/near/near-sdk-rs) 4.0, unchanged | `HVqQf5j47gTep7X4oPft8DVXYaPt6K9A1AXZpkGrT9Lo` |
| `emwk_deeds.wasm` | NEP-171 non-fungible token (land deeds) | the `non-fungible-token` example of near-sdk-rs 4.0, unchanged | `6inQQWn3RbpjjRcyiJa3Qgb7Z6YDqC1yEQYgZTiJe4UJ` |

## The Village Ledger

The game already puts a short SHA-256 of each day's public village state and of each NEAR AI morning plan in the memo of a
0.01 EMWK transfer. The Village Ledger keeps the **full** hashes in a contract of their own, where they can be read back
by day instead of searched for in memos:

| Method | Who | What |
|---|---|---|
| `new(writer)` | once, at setup | the village bank becomes the only writer |
| `record(kind, day, sha256, model?, tee?, signed?, signer?)` | the village bank only | `kind` is `state` or `ai_plan`; one record per kind and day; a day that is already recorded is refused, so **a record can never be changed**; emits a NEP-297 event (`emberwick_ledger`, `recorded`) |
| `get(kind, day)` | anyone (view) | that record, with the block height and time it was written |
| `latest(limit)`, `list(from, limit)`, `count()`, `writer()`, `version()` | anyone (view) | the newest records, or all of them page by page (at most 50 at a time) |

**Locked after setup.** Once the contract is deployed and started, the game deletes the ledger account's only access key.
The account then has no key at all: nobody, the village bank included, can deploy new code to it or change it any other
way. Check it: `view_access_key_list` for the ledger account returns no keys.

```bash
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"ledger.emberwick-village-2.testnet"}}'
```

Read a record (here: the village state at the end of day 5; `args_base64` is `{"kind":"state","day":5}` in base64):

```bash
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"ledger.emberwick-village-2.testnet","method_name":"get","args_base64":"eyJraW5kIjoic3RhdGUiLCJkYXkiOjV9"}}' | python3 -c 'import sys,json; print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'
```

Then compare its `sha256` with the hash of the JSON the game serves for that day at `/api/state-records`
(for an AI plan: `/api/ai/plan?day=N`). The game also lists what it has written at `/api/ledger`.

What it does not do: it does not hold money or deeds, and it cannot stop a dishonest server from recording a false state
in the first place. It proves that a record, once on NEAR, was not changed afterwards, and when it was written.

**Build it.** `cargo test` in `village-ledger/` runs the unit tests. The wasm was built with Rust 1.97 for
`wasm32-unknown-unknown`, with the standard library rebuilt for the plain WebAssembly 1.0 feature set
(`RUSTFLAGS="-C target-cpu=mvp -C link-arg=-s" cargo build --release --target wasm32-unknown-unknown -Z build-std=std,panic_abort`,
with `RUSTC_BOOTSTRAP=1`); `cargo near build` gives a working contract too, but not a byte-identical file. The code hash
above ties the deployed code to `emwk_ledger.wasm` in this repository.

## The two standard contracts

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
