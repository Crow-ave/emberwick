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

## A living market

- Gathering needs the right tool (pickaxe, axe, plow). Tools wear out and cost real money, so starting a new trade is a decision. Apprentices start with more coins but no tool.
- Prices follow supply and demand: each shop compares its stock with the stock it wants, and moves its prices toward that level. When everyone mines, ore gets cheap; a full store room stops buying.
- The 12 bot villagers look at prices every morning and move to the work that pays best, so supply rebalances by itself.
- Travelling merchants buy what the village has too much of, paid from the adventurer fund. Rich shops buy supplies from outside, which refills that fund. Money keeps circulating; the total never changes.

## Jobs and homes

- Every morning the AI craftsmen who can afford it post an apprentice job on the notice board: a wage per shift, a length in days and the experience they ask for (the smithy wants mining level 2, the carpenter woodcutting level 3; the inn, bakery and tower take beginners).
- Applying is judged by the craftsman, who explains the decision ("You need mining level 2, come back with more experience"). Someone who just quit a job early is turned away for two days.
- A signed contract is written to NEAR: a small signing bonus from the employer carries the full terms (wage, shifts per day, days, severance, notice fee) in the transfer memo, so anyone can read it on the explorer.
- One shift a day costs energy, pays the wage straight from the craftsman's wallet and adds a product to the shop's shelf.
- If the shop is burned by the dragon or cannot pay, the contract ends and the player gets severance. If the craftsman cannot pay it, the village treasury does.
- Three village-owned homes can be rented. The deposit is held, rent goes to the treasury every morning, and sleeping at home restores energy once a day. Missing rent uses the deposit and ends the lease.

## Village council (DAO)

- In the council hall anyone can propose: fund a craftsman from the treasury, change the market tax (1-6%), top up the newcomer fund, or hold a festival that pays every villager. Proposing costs a small fee to the treasury.
- Players, the 12 bot villagers and the 7 AI craftsmen all vote, each in their own interest (shops want lower tax, the guard wants sword money before a dragon attack, villagers like festivals).
- Vote weight is hybrid: half the square root of your coins, plus days lived in the village (max 10), plus what you gave (taxes, shifts, goods sold; max 10). Wealth helps, but cannot buy the vote alone.
- A vote lasts one game day and needs at least 4 voters. Passed decisions are carried out automatically, and the treasury never goes below its reserve. Every payment is mirrored to NEAR like any other transfer.

## On NEAR

EMWK is a real NEP-141 token on NEAR testnet, and the game ledger is mirrored onto it.

- On first start the game creates its own accounts: a village bank (`emberwick-village.testnet`), the token contract (`emwk.emberwick-village.testnet`), the treasury and one account per AI craftsman (for example `smithy.emberwick-village.testnet`). Each craftsman signs its own transfers.
- Every trade, wage, tax and reward is queued, netted and sent as batched `ft_transfer` calls. The NEAR panel (top bar) shows the accounts, their on-chain balances and the latest transactions with explorer links.
- Players and bot villagers are held by the village bank. A player can link a NEAR testnet wallet (for example a Meteor Wallet testnet account) and cash EMWK out to it.
- If NEAR is unreachable the game keeps running. A regular balance sync compares the chain with the game and corrects any difference.
- The game asks the testnet faucet for its first account. If the faucet is busy, the NEAR panel and the terminal show an address to send a few testnet NEAR to.
- Keys are stored in `~/.emberwick/near-keys.json` on your own computer, outside the project folder, so they never reach GitHub. Never share this file.

## Coming next

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
