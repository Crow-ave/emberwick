# Emberwick

**A living village economy on NEAR.** Built at NEAR HACKATHON.

The dragon burned Emberwick to ash. Years later, a few craftsmen came back and relit the embers. Newcomers gather wood, wheat and iron ore, sell them to the village's craftsmen, and help the village get ready before the dragon returns.

Nobody sets the prices. Seven AI craftsmen, each with their own wallet, buy what they need, make what they sell and change their prices as stock runs short or piles up. A drought, a hard winter or smoke over Dragon peak ripples through the whole village with no patch from the developers.

## What works today (stage 1)

- Isometric village map with 19 places, drawn in the browser
- Seven AI craftsmen with their own wallets, stock, recipes and prices that follow supply and demand
- Production chains: wood → lumber → carts, wheat → flour → bread → meals, ore + wood → swords and pickaxes
- Gathering in the forest, fields and mine (energy-based, tools give a bonus)
- Selling to and buying from craftsmen, with a 3% market tax to the village treasury
- Village treasury with a fixed reserve, profit tax on rich shops and a guard salary
- Random events: droughts, winters, dragon warnings and attacks, judged by village readiness
- Twelve villager bots that keep the economy moving
- Four languages: English, Türkçe, Français, Deutsch (menu in the top bar; add more in `public/i18n.js`)
- A fixed supply of 25,000 EMWK. Money only moves between accounts and never appears from nowhere (checked by `npm test`)

## On NEAR

EMWK is a real NEP-141 token on NEAR testnet, and the game ledger is mirrored onto it.

- On first start the game creates its own accounts: a village bank (`emberwick-village.testnet`), the token contract (`emwk.emberwick-village.testnet`), the treasury and one account per AI craftsman (for example `smithy.emberwick-village.testnet`). Each craftsman signs its own transfers.
- Every trade, wage, tax and reward is queued, netted and sent as batched `ft_transfer` calls. The NEAR panel (top bar) shows the accounts, their on-chain balances and the latest transactions with explorer links.
- Players and bot villagers are held by the village bank. A player can link a NEAR testnet wallet (for example a Meteor Wallet testnet account) and cash EMWK out to it.
- If NEAR is unreachable the game keeps running. A regular balance sync compares the chain with the game and corrects any difference.
- The game asks the testnet faucet for its first account. If the faucet is busy, the NEAR panel and the terminal show an address to send a few testnet NEAR to.
- Keys are stored in `~/.emberwick/near-keys.json` on your own computer, outside the project folder, so they never reach GitHub. Never share this file.

## Coming next

- Apprentice job contracts with automatic wages and severance
- Room and house rentals with deposits and automatic rent
- Village council (DAO): proposals, votes and treasury spending
- Items as NEP-245 tokens
- Haggling with the AI craftsmen

## Run it

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install   # once: installs near-api-js for the NEAR bridge
npm start
```

Then open http://localhost:3000. One game day lasts 8 minutes.

```bash
npm run demo   # fast mode for recording: one game day lasts 2 minutes
```

```bash
npm test   # 100 game days of economy checks, then the NEAR bridge against an in-memory chain
```

## Project layout

| Path | What it is |
|---|---|
| `server/world.js` | The fixed world: buildings, goods, craftsmen, rules, token supply |
| `server/economy.js` | The economy engine: ledger, trading, craftsmen AI, events |
| `server/index.js` | Game server and live updates |
| `server/near.js` | NEAR bridge: account setup, token deploy, batched transfers, balance sync |
| `contracts/emwk_token.wasm` | Standard NEP-141 fungible token contract (near-contract-standards) |
| `public/iso.js` | The visual layer (isometric map). Can be replaced without touching game data |
| `public/app.js` | Panels, joining, actions |

## License

MIT
