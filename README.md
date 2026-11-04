# Emberwick

**A living village economy on NEAR.** Built at NEAR HACKATHON.

The dragon burned Emberwick to ash. Years later, a few craftsmen came back and relit the embers. Newcomers gather wood, wheat and iron ore, sell them to the village's craftsmen, and help the village get ready before the dragon returns.

Nobody sets the prices. Eight AI craftsmen, each with their own wallet, buy what they need, make what they sell and change their prices as stock runs short or piles up. A drought, a hard winter or smoke over Dragon peak ripples through the whole village with no patch from the developers.

## What works today (stage 1)

- Isometric village map with 19 places, drawn in the browser
- Seven AI craftsmen with their own wallets, stock, recipes and prices that follow supply and demand
- Production chains: wood → lumber → carts, wheat → flour → bread → meals, ore + wood → swords and pickaxes
- Gathering in the forest, fields and mine (energy-based, tools give a bonus)
- Selling to and buying from craftsmen, with a 3% market tax to the village treasury
- Village treasury with a fixed reserve, profit tax on rich shops and a guard salary
- Random events: droughts, winters, dragon warnings and attacks, judged by village readiness
- Day and night: at night the shops close (the inn stays open), nobody gathers or works shifts, and villagers walk home to sleep
- Shelter: at night a player sleeps in their rented home, their own house or a paid bed at the inn (5 EMWK) and recovers fast. A night outside means no rest and a cold morning (max energy −3 for the day)
- Winter comes 2 days in every 8: snow on the ground and roofs, nothing grows in the fields (no wheat harvest until spring), and the bakery needs firewood. Without a coat you are cold: outdoor work costs 1 more energy, you rest at half speed, and winter nights outside drain energy
- A craftsman whose purse runs almost empty gets a 150 EMWK hand from the treasury, so one hard winter cannot break the wheat → flour → bread chain
- The tailor (an eighth AI craftsman) sews winter coats from wool. Wool comes from the sheep pasture (you need shears from the tailor). Coats last 6 winter days; bot villagers buy them too
- Dragon peak slowly turns red as an attack comes closer
- Twelve villager bots that keep the economy moving
- Six languages: English, Türkçe, Français, Deutsch, Русский, 中文 (menu in the top bar; add more in `public/i18n.js`)
- Fishing at the pond (a rod from the carpenter); the innkeeper cooks meals from fish
- A fixed supply of 25,000 EMWK. Money only moves between accounts and never appears from nowhere (checked by `npm test`)

## AI craftsmen that haggle, learn and grow

- **Haggling:** a craftsman buys only what they need, and each extra unit is worth a little less to them (the same supply-and-demand rule that moves prices). The sell button shows the offer ("Sell 12 for 29"); the rest you sell later, elsewhere or on the exchange.
- **Learning:** every morning each craftsman looks at what sold in the last days and keeps more of what sells well, less of what does not. The shop panel shows what they learned.
- **Growing:** a craftsman who earns well expands the workshop (up to level 3): faster production and bigger stock. The expansion is paid to the carpenter, who builds it, so the money stays in the village.
- **The inn has 4 rooms**; travellers take some each night. When it is full, it is full.

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

## Land, homes and deeds

- Four plots of building land are spread around the village (north, east, south and west). A plot costs 120 EMWK, paid to the treasury.
- The buyer gets a **deed: a NEP-171 NFT** on NEAR (`deeds.emberwick-village.testnet`, near-sdk-rs 4.0 standard contract with events). It goes to the buyer's verified wallet; without one, the village bank holds it and moves it to the wallet once the player verifies.
- On their own plot a player builds a home with 6 lumber and 40 EMWK for the carpenter. To sleep there they need a bed (the carpenter makes and sells beds).
- Land is dearer near the centre: the four village plots cost 144–168 EMWK; plots in the neighbourhoods are cheaper the further they are from the gate.
- **Renting out a home:** an owner sets a daily rent and another player moves in. Every morning the rent goes from the tenant straight to the owner, player to player, on NEAR.
- **Neighbourhoods:** when land runs out, the council votes to open Ember Lane (12 plots, 78–108 EMWK); the treasury pays the carpenter and the woodcutter for roads and clearing. After that, Villa hill (6 big plots, 312–360 EMWK, level 5 needed, a villa takes 14 lumber). The AI villagers propose a new neighbourhood themselves when free plots run low.

## Watchtowers

- Anyone can propose "Build a watchtower" at the council. If it passes, the treasury pays the carpenter 250 EMWK and a new tower goes up on one of three free spots on the map.
- Each extra tower adds 10% to village readiness against the dragon. The AI villagers propose and back towers when danger is high.

## The Exchange quarter

Always open, reached from the signpost by the gate (or the hills on the horizon). The exchange hall has three counters:

- **Goods market (player to player):** put your goods up for sale at your own price. Other players buy them; the AI craftsmen and villagers also buy when your price beats the shops. The goods wait in the exchange until sold or for 3 days. 2% of each sale goes to the treasury.
- **Land deeds (NFT):** sell your land, with its house, bed and tenant, to another player. The deed NFT is held in escrow by the village bank: if it is already in your own wallet you send it there first (one Meteor signature, checked on chain), and after the sale the bank sends it to the buyer's verified wallet.
- **Change desk:** move EMWK between the game and your wallet (cash-out and deposit), and see live prices and real cross-chain quotes (NEAR → USDC, BTC, ETH, SOL) from the **NEAR Intents 1Click API** in dry-run mode: real solver prices, nothing is swapped. EMWK is a testnet game token, so it has no market price of its own.

## Hackathon tracks

| Track | What in Emberwick |
|---|---|
| Games With Real Economies | The whole game: AI merchants with their own wallets, prices that move by themselves, jobs, rent, land, a fixed-supply token |
| Unstoppable DeFi | The Exchange quarter: player order book, deed escrow, NEAR Intents quotes |
| NFTs That Do Something | Land deeds (NEP-171): a deed earns rent from a tenant, lets you sleep at home, and can be sold on the exchange |
| Open Innovation | A village DAO where AI villagers vote with reasons, recorded on NEAR |

## Try it as a judge (do X, see Y)

1. `npm install && npm run demo`, open http://localhost:3000, type a name, pick **Miner**. → You stand at the gate; the guide on the right says what to do.
2. Click the **Mine**, press the big button twice. → Ore in your bag; the guide points to the best buyer.
3. Click the **Smithy**. → The scene opens, the smith greets you in a speech bubble; sell on the counter card. Watch prices move in "Prices now".
4. Click the **Treasury**. → The books open over the map: balance, locked reserve, where money came from this week.
5. Click **Neighbourhoods** (or the hills top left) → **Exchange quarter**. Sell an item on the **Goods market**; open **Change desk** and press **Get a live quote**. → A real NEAR Intents quote (dry run).
6. Wait for evening (≈1.5 min in demo mode). → The guide asks where you will sleep; at the inn take a bed, your character lies down.
7. Click the **Council hall**, propose **Build a watchtower**. → AI villagers vote with reasons; the result is recorded on NEAR with a 0.01 EMWK memo transfer.

## On NEAR

EMWK is a real NEP-141 token on NEAR testnet, and the game ledger is mirrored onto it.

- On first start the game creates its own accounts: a village bank (`emberwick-village.testnet`), the token contract (`emwk.emberwick-village.testnet`), the treasury and one account per AI craftsman (for example `smithy.emberwick-village.testnet`). Each craftsman signs its own transfers.
- Every trade, wage, tax and reward is queued, netted and sent as batched `ft_transfer` calls. The NEAR panel (top bar) shows the accounts, their on-chain balances and the latest transactions with explorer links.
- Players and bot villagers are held by the village bank. A player connects Meteor Wallet (through NEAR Wallet Selector) and signs a one-time NEP-413 message; the server checks the signature against the account's full-access key, so the link proves ownership.
- Money flows both ways: cash EMWK out to your own wallet, or deposit it back by signing an `ft_transfer` to the village bank in Meteor. The server reads that transaction from the chain (signer, token, receiver, amount) before crediting it, and never counts the same transaction twice.
- Council decisions are recorded on chain: when a vote closes, the treasury sends a 0.01 EMWK record whose memo holds the proposal, the result and the vote weights.
- If NEAR is unreachable the game keeps running. A regular balance sync compares the chain with the game and corrects any difference.
- The game asks the testnet faucet for its first account. If the faucet is busy, the NEAR panel and the terminal show an address to send a few testnet NEAR to.
- Keys are stored in `~/.emberwick/near-keys.json` on your own computer, outside the project folder, so they never reach GitHub. Never share this file.

## Coming next

- Items as NEP-245 tokens
- Haggling with the AI craftsmen
- Real swaps on the change desk (mainnet)

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
| `public/vendor/near-wallet.js` | Meteor Wallet through NEAR Wallet Selector, bundled for the browser (source in `tools/wallet/`) |
| `contracts/emwk_deeds.wasm` | Standard NEP-171 NFT contract for land deeds (near-sdk-rs 4.0 example) |
| `contracts/emwk_token.wasm` | Standard NEP-141 fungible token (near-sdk-rs 4.0 example, emits NEP-297 events so explorers and wallets index it) |
| `public/iso.js` | The visual layer (isometric map). Can be replaced without touching game data |
| `public/app.js` | Panels, joining, actions |

## License

MIT


## Roadmap (after the hackathon)

- Transport: a paid village bus and minibus; walking takes longer, so you can be late for work. Later carts and cars that need fuel.
- Growing businesses: a workshop can grow into a factory (a sword foundry, a large joinery) as its owner levels up; later large workplaces and plazas in the town centre.
- New craftsmen by vote: if a shop goes broke and its craftsman leaves, the council votes to bring in a new AI craftsman. The old craftsman's money goes back to the treasury.
- More neighbourhoods that open with levels, each with its own building rules (e.g. villas only on Villa hill).
