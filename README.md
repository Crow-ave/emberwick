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
- A fixed supply of 25,000 EMWK. Money only moves between accounts and never appears from nowhere (checked by `npm test`)

## Coming next

- Apprentice job contracts with automatic wages and severance
- Room and house rentals with deposits and automatic rent
- Village council (DAO): proposals, votes and treasury spending
- EMWK as a NEP-141 token on NEAR testnet, items as NEP-245, a NEAR account for every craftsman
- Haggling with the AI craftsmen

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. No other packages are required.

```bash
npm start
```

Then open http://localhost:3000. One game day lasts 8 minutes.

```bash
npm run demo   # fast mode for recording: one game day lasts 2 minutes
```

```bash
npm test   # runs the economy for 100 game days and checks the money supply
```

## Project layout

| Path | What it is |
|---|---|
| `server/world.js` | The fixed world: buildings, goods, craftsmen, rules, token supply |
| `server/economy.js` | The economy engine: ledger, trading, craftsmen AI, events |
| `server/index.js` | Game server and live updates |
| `public/iso.js` | The visual layer (isometric map). Can be replaced without touching game data |
| `public/app.js` | Panels, joining, actions |

## License

MIT
