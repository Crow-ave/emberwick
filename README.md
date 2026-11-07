# Emberwick

**A living village economy on NEAR.** Built at NEAR HACKATHON.

**▶ Play it now: [emberwick-xcf8.onrender.com](https://emberwick-xcf8.onrender.com)** (desktop and phone) · press **Judge tour** in the top bar for a two-minute walk through every NEAR part.

> A medieval village where **AI agents with their own NEAR wallets** run the shops, **think privately inside a TEE** (NEAR AI Cloud), and trade in a **real token economy on NEAR**: players haggle with them, take orders and credit, own land as NFTs, vote in a DAO, and the exchange quotes **live cross-chain swaps through NEAR Intents**.

| NEAR part | What it does in Emberwick | See it |
|---|---|---|
| 🤖 **AI agents with wallets** | 7 craftsmen, each with its own NEAR account, plan their stock and prices every morning and trade on their own; players talk, haggle, order and ask for credit, and the agents answer with real, rule-checked actions | Talk to any shop · [tailor.emberwick-village.testnet](https://testnet.nearblocks.io/address/tailor.emberwick-village.testnet) |
| 🔒 **Private, verifiable AI (TEE)** | The agents think with NEAR AI Cloud models running in a TEE; the attestation report is fetched with a fresh nonce, and every morning plan's SHA-256 is recorded on NEAR in a memo | Shop panel → 🔒 and ⛓ lines · `/api/ai/attestation` · `/api/ai/plan` |
| 🌉 **NEAR Intents** | **A real cross-chain swap on mainnet** from the game (small amounts, your own wallet: wNEAR → USDC/SOL on NEAR, Solana or Base, followed live to delivery, then recorded in the village's books on testnet). Plus live 1Click quotes: swap NEAR to USDC/BTC/ETH/SOL, pay for land from another chain, a DAO treasury reserve with a live quote, the NEAR price as an oracle for the village economy | Exchange quarter |
| ⛓ **On-chain economy** | EMWK (NEP-141, fixed supply 25,000), land deeds as NFTs (NEP-171) that let you build, sleep, rent out and vote, a village DAO; every trade settles on NEAR in batches | [token](https://testnet.nearblocks.io/address/token.emberwick-village.testnet) · [deeds](https://testnet.nearblocks.io/address/deeds.emberwick-village.testnet) · [bank](https://testnet.nearblocks.io/address/emberwick-village.testnet) · [treasury](https://testnet.nearblocks.io/address/treasury.emberwick-village.testnet) |

(Free hosting: the first visit after a quiet spell can take about a minute to wake up, and the online village starts again from day 1 after a restart. The online demo has its own village bank on testnet, [emberwick-village-2.testnet](https://testnet.nearblocks.io/address/emberwick-village-2.testnet), with its token [emwk.emberwick-village-2.testnet](https://testnet.nearblocks.io/address/emwk.emberwick-village-2.testnet); the links in the table are the first village's.)

The dragon burned Emberwick to ash. Years later, a few craftsmen came back and relit the embers. Newcomers gather wood, wheat and iron ore, sell them to the village's craftsmen, and help the village get ready before the dragon returns.

Nobody sets the prices. Eight AI craftsmen, each with their own wallet, buy what they need, make what they sell and change their prices as stock runs short or piles up. A drought, a hard winter or smoke over Dragon peak ripples through the whole village with no patch from the developers.

## What works today (stage 1)

- Isometric village map with 19 places, drawn in the browser
- Seven AI craftsmen with their own wallets, stock, recipes and prices that follow supply and demand
- Production chains: wood → lumber → carts, wheat → flour → bread → meals, ore + wood → swords and pickaxes
- Gathering in the forest, fields and mine (energy-based, tools give a bonus)
- Selling to and buying from craftsmen, with a 3% market tax to the village treasury
- Village treasury with a fixed reserve, profit tax on rich shops, a guard salary and a small morning village tax (1% of what anyone holds above 300 EMWK), so the treasury stays steady instead of slowly running dry
- Random events: droughts, winters, dragon warnings and attacks, judged by village readiness
- Day and night: at night the shops close (the inn stays open), nobody gathers or works shifts, and villagers walk home to sleep
- Shelter: at night a player sleeps in their rented home, their own house or a paid bed at the inn (5 EMWK) and recovers fast. A night outside means no rest and a cold morning (max energy −3 for the day)
- Winter comes 2 days in every 8: snow on the ground and roofs, nothing grows in the fields (no wheat harvest until spring), and the bakery needs firewood. Without a coat you are cold: outdoor work costs 1 more energy, you rest at half speed, and winter nights outside drain energy
- A craftsman whose purse runs almost empty gets a 150 EMWK hand from the treasury, so one hard winter cannot break the wheat → flour → bread chain
- The tailor (an eighth AI craftsman) sews winter coats from wool. Wool comes from the sheep pasture (you need shears from the tailor). Coats last 6 winter days; bot villagers buy them too
- Dragon peak slowly turns red as an attack comes closer
- Twelve villager bots that keep the economy moving
- One "Buy & sell" list (button under your name): every good in the village with the best price and the shop that has it. Press Buy or Sell and your villager walks there and trades
- Close-up scenes for every work place, now also the sheep pasture (shearing among the sheep) and the fishing pond (on the jetty with a rod). Outdoor scenes follow the clock: moon and stars at night
- **Pay from any chain (universal checkout preview):** buying a plot or renting a home shows a "pay from another chain" button. Pick USDC on Solana or Ethereum, ETH, BTC or SOL, and NEAR Intents quotes live how much you would send to cover the EMWK price (EXACT_OUTPUT into NEAR, dry run; nothing is sent because Intents runs on mainnet and the village on testnet)
- **Live NEAR price feeds the economy:** the exchange quarter reads the NEAR price from NEAR Intents every 10 minutes. Travellers pay with NEAR, so when NEAR is above its 7-day average they pay more EMWK for the village's goods and meals (at most +20%), below it less (at most −15%)
- **DAO treasury reserve with NEAR Intents:** the council can vote to set 5–25% of the spare treasury aside as USDC or BTC for 14 days. The proposal carries a live NEAR Intents quote (dry run: what it would buy today, at the village rate of 100 EMWK = 1 NEAR); the decision and the quote are recorded on NEAR, and the reserve cannot be spent until it is released
- **Why the council has a fixed menu of decisions:** every passed proposal is carried out by the game itself, so only decisions the code knows how to execute can be voted on. Free-form "send treasury money anywhere" proposals are the classic DAO drain attack; here a proposal fee, a locked 2,000 EMWK reserve, caps per decision and vote weight that also counts time in the village and contribution keep the treasury safe
- Village chat (the Chat tab next to Village news): short public messages that also pop up as a speech bubble over the sender on the map. Click another player on the road to see who they are and write to them
- Small work sounds made live in the browser (no sound files): rustling wheat at the fields, pickaxe clinks in the mine, the anvil at the smithy, the axe, the saw, a sheep's baa and shears at the pasture, a splash at the pond, coins when you trade. A quiet music loop plays a slower, lower tune at night. Two buttons in the top bar turn sounds and music on or off
- Six languages: English, Türkçe, Français, Deutsch, Русский, 中文 (menu in the top bar; add more in `public/i18n.js`)
- Fishing at the pond (a rod from the carpenter); the innkeeper cooks meals from fish
- A fixed supply of 25,000 EMWK. Money only moves between accounts and never appears from nowhere (checked by `npm test`)

## AI craftsmen that haggle, learn and grow

**The craftsmen think with [NEAR AI Cloud](https://docs.near.ai)** (OpenAI-compatible, TEE-backed private inference). Every village morning, while someone is playing, one request gives the model the real numbers of every shop (stock, target, prices, recent sales, winter, dragon, drought, the live NEAR price) and the model plans the day for each craftsman: what to stock up on, what to discount, and a reason. The shop panel shows the plan and the model name. Players can also **ask a craftsman a question** in any of the six languages; the craftsman answers in character from the shop's real numbers.

**Talking to a craftsman is how you get things done:** each craftsman has a character and knows the whole village (who sells, buys and makes what, where raw goods come from) and what you carry. The model answers in JSON: its words plus up to three suggested actions (buy, sell, order, credit, go to another place). The village rules check every suggestion and show it as a button under the answer; nothing happens until you press it. Ask the woodcutter for a sofa and he says nobody makes those, offers lumber and sends you to the carpenter.

**Conversations and credit:** questions and answers appear as speech bubbles over you and the craftsman, and the craftsman remembers the last few lines, so a conversation can go on. A hungry player with almost no money can ask the baker or the innkeeper for food on credit: the rules say what is possible (needy, no open debt, paid back last time, at most 2 bread or 1 meal), the model decides whether to say yes, and the debt is collected from the player's purse in the morning. Miss the 3-day deadline and that shop gives no more credit.

**Orders:** bring your own materials (e.g. 3 wool to the tailor), pay a work fee, get the product (a coat). The fee is part of the value the work adds. Order with the button at the counter, or just agree in conversation: the craftsman takes the order through NEAR AI, inside the same rules. Craftsmen only offer what the game can really do.

**Haggling:** every row at a shop counter has a 🤝 button. Name your price per unit; the craftsman accepts, meets you in the middle, refuses but makes you a special offer, or takes offence at a lowball (twice, and they stop haggling with you for the day). The village rules decide the outcome from stock, target and your trading skill; NEAR AI only voices the answer in character and in your language. A counter offer is one click away.

**Verifiable AI on NEAR:** every morning plan is recorded on NEAR: a 0.01 EMWK transfer from the treasury carries the SHA-256 of the exact plan in its memo. `/api/ai/plan?day=N` serves that exact JSON, so anyone can hash it and compare. `/api/ai/attestation` serves NEAR AI Cloud's TEE attestation report (Intel TDX quote and the enclave signing key, fetched with a fresh nonce); the shop panel shows both.

Safety by design: the model only *nudges* inside fixed limits (stock target ×0.7–1.4, sell price ×0.9–1.1). Every coin still moves by the village rules in `server/economy.js`, and answers are only words. Without a key, offline, or past the daily request limit, the craftsmen fall back to the rule-based behaviour below. The code is in `server/ai.js`.

All pricing rules are in one readable file, **`server/pricing.js`**. Every price in a shop has an ⓘ tooltip with the craftsman's reasoning (stock vs. target, winter, dragon, drought, what they learned, workshop size).

- **Hiring:** applying for a job hands in an application. The craftsman interviews every applicant at the next interview round (every ~1.5 game hours while the shop is open; applications made at night wait for the morning). The best fit for the work gets the job, and a more skilled apprentice is offered a higher wage (up to +60%). The others hear why they were not chosen.

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

**A real NEAR Intents swap (mainnet):** NEAR Intents has no testnet, so the Exchange's NEAR bridge tab has a "Real swap (mainnet)" mode that does a real one with small amounts. The game asks 1Click for a real quote (`dry: false`) and shows the deposit address. You send wNEAR from your own NEAR wallet, and the game follows the swap through deposit seen, processing and delivered, with both transaction links. A finished swap goes into village news and is recorded on NEAR testnet in a memo with the mainnet transaction hash. It works both ways: NEAR → another chain (send wNEAR, get e.g. USDC or SOL), or another chain → NEAR (pay USDC or SOL from Solana or Base and receive NEAR on your NEAR account: NEAR Intents delivers wNEAR as plain NEAR). The swap card works like an exchange: "You send" on top, "You get" below, with token buttons that show each token's chain; the ⇄ button (on the card or on the bridge picture) turns the swap round and the picture swaps sides. You can also just say it: type "Send 0.3 NEAR to my Solana wallet as USDC" and NEAR AI (in a TEE) reads the sentence into the swap card. The server checks every value against the menu and the limits, addresses are only taken from your words or wallets you used before in this browser, and if nothing is missing the real quote is taken at once. The AI never moves money: you still send from your own wallet. Until money is sent, a swap can be cancelled to go back to the card (a wrong address, a change of mind). A real one made from the game: 0.005 SOL on Solana → 0.1205 NEAR on `emberwick.near` ([NEAR Intents explorer](https://explorer.near-intents.org/transactions/8pbsZb3giBZLihUSarvtvQDR4gNbz5Td7WP4gdCyRMDC), [delivery on NearBlocks](https://nearblocks.io/txns/CuxvRFFyGCpXyvQh8kB5QnpN3FdhSLfv4pxW7ScT6Ad6)). Connect your own wallet (Meteor or MyNearWallet for NEAR, Phantom for Solana, MetaMask for Base) and the deposit goes out with one approval in that wallet: on NEAR one transaction wraps your NEAR and sends the wNEAR to the deposit address, so you do not need wNEAR first. Connecting only fills in your address; the wallet shows the amount and the address before you approve, and the transaction hash is reported to NEAR Intents for you. The wallet code is bundled in `public/vendor/wallets.js` (source: `public/vendor/wallets.src.mjs`) and loads only when a player connects a wallet. **Any token on any chain:** the swap card's token pickers list everything NEAR Intents can swap right now (live from 1Click, searchable, filtered by chain): NEAR, Solana, Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Bitcoin, Tron and more. NEAR does not have to be on either side: Base → Solana works too, and NEAR Intents still settles it on NEAR behind the scenes, so NEAR is the meeting point of all the chains. Limits are in dollars ($0.40–$20; NEAR keeps 0.1–5 NEAR). Connecting lists the wallets installed in the browser (EIP-6963 for EVM wallets such as MetaMask and Rabby, Wallet Standard for Solana wallets such as Phantom and Solflare), and the player picks one. The connected wallet sends with one approval from NEAR (any NEP-141 token), Solana (SOL or any SPL token) and any EVM chain (the coin or an ERC-20, switching the wallet to that chain); chains with no browser wallet (e.g. Bitcoin) are sent by hand to the deposit address. For routes that do not touch NEAR, "Other routes" also shows LI.FI's own quote for the same swap, so the two can be compared side by side. A split can send each part to any token on any chain. **Split one send across chains:** "+ Split to several receivers" turns the card into 2–5 rows, each with its own token, chain and receiver (e.g. USDC on Solana for one friend, USDC on NEAR for another, USDC on Base for a third). The game takes all the quotes at once (all or none), and the connected NEAR wallet sends every part in **one transaction with one approval**: it wraps the total once and sends each part to its own deposit address. Each part is followed on its own until delivered. This is NEAR's chain abstraction in one click: one signature, several chains. **What a swap really costs:** before you approve, the quote shows what you send, what arrives, and the total cost (fees and price difference together), with both sides valued at an independent market price (CoinGecko) next to NEAR Intents' own figures, plus the network fee your wallet will add and the time estimate. On our first real swap (0.005 SOL → 0.1205 NEAR) the total cost was about 1%. Under it, **Other routes** are checked live for the same swap: Omni Bridge (NEAR's own bridge) gives its bridge fee, with the note that it only moves the token (you would get bridged NEAR, not USDC), and LI.FI, the largest bridge aggregator, is asked for its chain list (it does not list NEAR, so it cannot do these routes). It is only a comparison: the swap itself always goes through NEAR Intents. Each connected wallet has Change and Disconnect buttons. The game never holds keys or funds. Limits: 0.1–5 NEAR out, 0.5–15 USDC or 0.003–0.1 SOL in, a few quotes per player per hour, and a refund to your own account if the swap does not complete.

**Newcomer families:** if no player buys, each morning the village treasury buys one deed priced at most 10% over its fair value (land + house + bed) for a family moving in, and sells the plot again at that value. Land always has a buyer at a fair price.

**Money history, open books:** every transfer in the village is kept with why it happened (sale, purchase, market tax, rent, wage, council payout, AI plan record...). Players see their own history (📜 under "My wealth"), and every craftsman's and the treasury's history is public. Each line links to the NEAR transaction that carried it, or says why none was needed (netted in a batch, a balance sync, both sides in the same account).

**Land market:** one list with every deed (NFT) players sell, including your own listing, every free village plot, and recent deed sales, with links to each NFT on NEAR.

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
| Open Innovation | Craftsmen who plan their day with NEAR AI Cloud (verifiable private inference) inside safe limits; a village DAO where AI villagers vote with reasons, recorded on NEAR |

## Try it as a judge (do X, see Y)

**Fastest way:** press **Judge tour** in the top bar. It walks you through the NEAR parts in about two minutes (NEAR AI craftsmen, haggling and credit, the EMWK token, land-deed NFTs, NEAR Intents, the DAO, the one-week fast-forward), with links to every account on NearBlocks.

1. `npm install && npm run demo`, open http://localhost:3000, type a name, pick **Miner**. → You stand at the gate; the guide on the right says what to do.
2. Click the **Mine**, press the big button twice. → Ore in your bag; the guide points to the best buyer.
3. Click the **Smithy**. → The scene opens, the smith greets you in a speech bubble; sell on the counter card. Watch prices move in "Prices now".
   In the shop panel, the blue **NEAR AI** box shows today's plan from the model; type a question ("What is expensive today?") and the craftsman answers in your language.
4. Click the **Treasury**. → The books open over the map: balance, locked reserve, where money came from this week.
5. Click **Neighbourhoods** (or the hills top left) → **Exchange quarter**. Sell an item on the **Goods market**; open **Change desk** and press **Get a live quote**. → A real NEAR Intents quote (dry run).
6. Wait for evening (≈1.5 min in demo mode). → The guide asks where you will sleep; at the inn take a bed, your character lies down.
7. Press **⏩ 1 week** in the top bar. → One week of village life runs in about a minute with nobody touching the prices; a summary then shows how prices moved, which AI craftsmen won or lost, workshop upgrades and council decisions.
8. Click the **Council hall**, propose **Build a watchtower**. → AI villagers vote with reasons; the result is recorded on NEAR with a 0.01 EMWK memo transfer.

## On NEAR

EMWK is a real NEP-141 token on NEAR testnet, and the game ledger is mirrored onto it.

- On first start the game creates its own accounts: a village bank (`emberwick-village.testnet`), the token contract (`token.emberwick-village.testnet`), the treasury and one account per AI craftsman (for example `smithy.emberwick-village.testnet`). Each craftsman signs its own transfers.
- Every trade, wage, tax and reward is queued, netted and sent as batched `ft_transfer` calls. The NEAR panel (top bar) shows the accounts, their on-chain balances and the latest transactions with explorer links.
- Players and bot villagers are held by the village bank. A player connects Meteor Wallet (through NEAR Wallet Selector) and signs a one-time NEP-413 message; the server checks the signature against the account's full-access key, so the link proves ownership.
- Money flows both ways: cash EMWK out to your own wallet, or deposit it back by signing an `ft_transfer` to the village bank in Meteor. The server reads that transaction from the chain (signer, token, receiver, amount) before crediting it, and never counts the same transaction twice.
- Council decisions are recorded on chain: when a vote closes, the treasury sends a 0.01 EMWK record whose memo holds the proposal, the result and the vote weights.
- **System status** (click *NEAR testnet · live* in the top bar): the village bank and its gas money with an explorer link, whether sending is paused for gas, the transaction queue, the NEAR AI model and its TEE attestation, and the server's last 50 `[NEAR]` / `[AI]` log lines with times. Also as JSON at `/api/system`. Keys are never logged.
- If NEAR is unreachable the game keeps running. A regular balance sync compares the chain with the game and corrects any difference.
- The game asks the testnet faucet for its first account. If the faucet is busy, the NEAR panel and the terminal show an address to send a few testnet NEAR to.
- Keys are stored in `~/.emberwick/near-keys.json` on your own computer, outside the project folder, so they never reach GitHub. Never share this file.

## Coming next

- Items as NEP-245 tokens
- Haggling with the AI craftsmen
- Real swaps on the change desk (mainnet), both directions, also by a sentence to NEAR AI

## Run it

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install   # once: installs near-api-js for the NEAR bridge
npm start
```

Then open http://localhost:3000. One game day lasts 8 minutes.

To let the craftsmen think with NEAR AI, create an API key at [cloud.near.ai](https://cloud.near.ai) and either set `NEARAI_API_KEY` or save the key in `~/.emberwick/nearai-key.txt` (outside the repo). Optional: `NEARAI_MODEL` picks a model, `NEARAI_DAILY_LIMIT` caps requests per day (default 400), `EMBERWICK_AI=0` turns it off.

To run a second, separate village on a host (like the online demo) with its own NEAR bank: run `npm run online-bank` once on your computer (it sets up a new village bank on testnet with keys in `~/.emberwick/online-keys.json`, and a separate save), then put the contents of that file into the host's secret environment variable `EMBERWICK_KEYS_JSON`. Keys are never committed or printed. Two villages must never share one bank.

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
| `server/ai.js` | NEAR AI Cloud: the craftsmen's morning plan and answers to players' questions |
| `server/near.js` | NEAR bridge: account setup, token deploy, batched transfers, balance sync |
| `public/vendor/near-wallet.js` | Meteor Wallet through NEAR Wallet Selector, bundled for the browser (source in `tools/wallet/`) |
| `contracts/emwk_deeds.wasm` | Standard NEP-171 NFT contract for land deeds (near-sdk-rs 4.0 example) |
| `contracts/emwk_token.wasm` | Standard NEP-141 fungible token (near-sdk-rs 4.0 example, emits NEP-297 events so explorers and wallets index it) |
| `public/iso.js` | The visual layer (isometric map). Can be replaced without touching game data |
| `public/app.js` | Panels, joining, actions |

## License

MIT


## Roadmap (after the hackathon)

- Real universal checkout on mainnet: a NEAR Intents deposit address per purchase, the plot or home handed over once the payment lands (needs the village on mainnet first)
- Swarm-for-Hire: the council posts a job, players fund AI apprentices with NEAR to pay for NEAR AI inference, the council reviews the work before it is paid
- A village prediction market ("will the dragon attack this week?") that writes the village chronicle

- Transport: a paid village bus and minibus; walking takes longer, so you can be late for work. Later carts and cars that need fuel.
- Growing businesses: a workshop can grow into a factory (a sword foundry, a large joinery) as its owner levels up; later large workplaces and plazas in the town centre.
- New craftsmen by vote: if a shop goes broke and its craftsman leaves, the council votes to bring in a new AI craftsman. The old craftsman's money goes back to the treasury.
- More neighbourhoods that open with levels, each with its own building rules (e.g. villas only on Villa hill).
