// Static definition of the Emberwick world.
// Every building, good and craftsman has a fixed id. Saved game data refers to
// these ids, so the visual layer can be redrawn later without touching anyone's
// property.

export const TOKEN = { symbol: 'EMWK', totalSupply: 25000 };

// How the fixed supply is split at genesis. Money never appears from nowhere:
// it only moves between these accounts and players.
export const GENESIS = {
  treasury: 9600,
  newcomerFund: 5000,
  adventurerFund: 5000,
  botFund: 1500,
  craftsmen: 3900,
};

export const GOODS = {
  wheat:   { name: 'Wheat',     kind: 'raw' },
  wood:    { name: 'Wood',      kind: 'raw' },
  ore:     { name: 'Iron ore',  kind: 'raw' },
  wool:    { name: 'Wool',      kind: 'raw' },
  fish:    { name: 'Fish',      kind: 'raw' },
  lumber:  { name: 'Lumber',    kind: 'made' },
  flour:   { name: 'Flour',     kind: 'made' },
  bread:   { name: 'Bread',     kind: 'made' },
  sword:   { name: 'Sword',     kind: 'made' },
  pickaxe: { name: 'Pickaxe',   kind: 'tool', boosts: 'ore' },
  axe:     { name: 'Axe',       kind: 'tool', boosts: 'wood' },
  plow:    { name: 'Plow',      kind: 'tool', boosts: 'wheat' },
  cart:    { name: 'Cart',      kind: 'tool', boosts: 'carry' },
  shears:  { name: 'Shears',    kind: 'tool', boosts: 'wool' },
  rod:     { name: 'Fishing rod', kind: 'tool', boosts: 'fish' },
  coat:    { name: 'Winter coat', kind: 'clothing' },
  bed:     { name: 'Bed',       kind: 'furniture' }, // a home you built needs one before you can sleep there // keeps you warm in winter; wears out after a few winter days
  meal:    { name: 'Meal',      kind: 'service' },
};

// Places the player can gather raw goods from.
export const GATHER_SPOTS = {
  // you need the right tool to work here (axe, plow, pickaxe); it wears out with use
  forest: { good: 'wood',  energy: 2, base: 2 },
  fields: { good: 'wheat', energy: 2, base: 2 },
  mine:   { good: 'ore',   energy: 3, base: 1 },
  pasture: { good: 'wool', energy: 2, base: 2 },
  pond:    { good: 'fish', energy: 2, base: 1 },
};

// Map layout on a 14x14 isometric grid. (i, j) = grid cell, w = footprint.
export const BUILDINGS = [
  { id: 'forest',     name: 'Forest',      type: 'gather',    i: 0,  j: 1,  w: 3 },
  { id: 'fields',     name: 'Fields',      type: 'gather',    i: 1,  j: 5,  w: 3 },
  { id: 'mine',       name: 'Mine',        type: 'gather',    i: 9,  j: 2,  w: 2 },
  { id: 'dragonpeak', name: 'Dragon peak', type: 'landmark',  i: 12, j: 0,  w: 2 },
  { id: 'woodcutter', name: 'Woodcutter',  type: 'craftsman', i: 4,  j: 1,  w: 1 },
  { id: 'mill',       name: 'Mill',        type: 'craftsman', i: 1,  j: 9,  w: 1 },
  { id: 'smithy',     name: 'Smithy',      type: 'craftsman', i: 8,  j: 3,  w: 1 },
  { id: 'carpenter',  name: 'Carpenter',   type: 'craftsman', i: 6,  j: 1,  w: 1 },
  { id: 'bakery',     name: 'Bakery',      type: 'craftsman', i: 4,  j: 9,  w: 1 },
  { id: 'inn',        name: 'Inn',         type: 'craftsman', i: 7,  j: 9,  w: 1 },
  { id: 'tower',      name: 'Guard tower', type: 'craftsman', i: 11, j: 8,  w: 1 },
  { id: 'market',     name: 'Market',      type: 'civic',     i: 5,  j: 5,  w: 2 },
  { id: 'council',    name: 'Council hall',type: 'civic',     i: 8,  j: 5,  w: 1 },
  { id: 'treasury',   name: 'Treasury',    type: 'civic',     i: 5,  j: 3,  w: 1 },
  { id: 'house-1',    name: 'Room',        type: 'house',     i: 9,  j: 10,  w: 1, size: 'room' },
  { id: 'house-2',    name: 'Small house', type: 'house',     i: 8,  j: 11,  w: 1, size: 'small' },
  { id: 'house-3',    name: 'Large house', type: 'house',     i: 11, j: 10, w: 1, size: 'large' },
  { id: 'pasture',    name: 'Sheep pasture', type: 'gather',  i: 0,  j: 10, w: 2 },
  { id: 'pond',       name: 'Fishing pond', type: 'gather',  i: 8,  j: 7,  w: 2 },
  { id: 'tailor',     name: 'Tailor',      type: 'craftsman', i: 3,  j: 10, w: 1 },
  { id: 'roadsign',   name: 'Road to the neighbourhoods', type: 'sign', i: 6, j: 13, w: 1 },
  { id: 'gate',       name: 'Village gate',type: 'landmark',  i: 5,  j: 13, w: 1 },
  // building land: four plots around the village players can buy and build a home on
  { id: 'plot-1',     name: 'Plot 1',      type: 'plot',      i: 1,  j: 12, w: 1 },
  { id: 'plot-2',     name: 'Plot 2',      type: 'plot',      i: 8,  j: 13, w: 1 },
  { id: 'plot-3',     name: 'Plot 3',      type: 'plot',      i: 12, j: 6,  w: 1 },
  { id: 'plot-4',     name: 'Plot 4',      type: 'plot',      i: 3,  j: 2,  w: 1 },
  // places where the council can order more watchtowers (empty until built)
  { id: 'watch-1',    name: 'Watchtower',  type: 'watch',     i: 13, j: 3,  w: 1 },
  { id: 'watch-2',    name: 'Watchtower',  type: 'watch',     i: 0,  j: 6,  w: 1 },
  { id: 'watch-3',    name: 'Watchtower',  type: 'watch',     i: 12, j: 12, w: 1 },
];

// New neighbourhoods outside the village. Each has its own little map. District 1
// (Ember Lane) is for everyone; district 2 (Villa hill) has big plots and only opens to
// experienced villagers. The council votes to open them; the treasury pays the work.
// Land is dearer near the centre: price = LAND.price x the plot's factor.
export const DISTRICTS = {
  1: { id: 'lane',  name: 'Ember Lane', cost: 600, needs: 0, minLevel: 0,
       build: { lumber: 6, fee: 40 }, factors: [0.9, 0.9, 0.85, 0.85, 0.8, 0.8, 0.75, 0.75, 0.7, 0.7, 0.65, 0.65] },
  3: { id: 'exchange', name: 'Exchange quarter', alwaysOpen: true, cost: 0, needs: 0, minLevel: 0, build: {}, factors: [] },
  2: { id: 'villa', name: 'Villa hill', cost: 1200, needs: 1, minLevel: 5,
       build: { lumber: 14, fee: 120 }, factors: [3, 3, 2.8, 2.8, 2.6, 2.6] },
};
// where the district plots sit on their own map (i, j on a 10x10 grid)
const LANE_CELLS = [[2, 2], [4, 2], [6, 2], [2, 4], [4, 4], [6, 4], [2, 6], [4, 6], [6, 6], [2, 8], [4, 8], [6, 8]];
const VILLA_CELLS = [[2, 2], [5, 2], [2, 5], [5, 5], [2, 8], [5, 8]];
for (const [n, cells] of [[1, LANE_CELLS], [2, VILLA_CELLS]]) {
  cells.forEach(([i, j], k) => BUILDINGS.push({ id: `d${n}-${k + 1}`, name: `${DISTRICTS[n].name} ${k + 1}`, type: 'plot', district: n, villa: n === 2, i, j, w: n === 2 ? 2 : 1 }));
}
// the exchange hall in the Exchange quarter: player market, land-deed market and the change desk
BUILDINGS.push({ id: 'exchange', name: 'Exchange', type: 'civic', district: 3, i: 3, j: 3, w: 3 });

// The exchange: players post sell orders for goods; anyone (players, AI craftsmen, villagers) can fill
// them. Deeds can be sold too. A small fee goes to the treasury.
export const MARKET = {
  goods: ['wheat', 'wood', 'ore', 'wool', 'fish', 'rod', 'lumber', 'flour', 'bread', 'coat', 'sword', 'bed', 'pickaxe', 'axe', 'plow', 'shears'],
  fee: 0.02,          // of every sale on the exchange, to the treasury
  maxOrders: 5,       // open orders per player
  days: 3,            // orders run this long, then the goods go back
  maxPrice: 500,
  deedMax: 5000,
};

// how dear each of the four village plots is (the centre is worth the most)
export const CENTRE_FACTOR = { 'plot-1': 1.2, 'plot-2': 1.3, 'plot-3': 1.25, 'plot-4': 1.4 };

// The seven craftsmen. They are AI agents with their own wallets.
// recipe: inputs consumed -> outputs produced, once per production step.
// buys/sells: starting prices in EMWK. target: stock level they aim for.
export const CRAFTSMEN = [
  {
    id: 'woodcutter', name: 'Bram the Woodcutter', wallet: 400,
    recipe: { in: { wood: 2 }, out: { lumber: 1 } },
    buys: { wood: 3 }, sells: { lumber: 8, axe: 30 },
    stock: { wood: 6, lumber: 4, axe: 3 }, target: { wood: 10, lumber: 6, axe: 3 },
    lines: ['Good timber keeps a village standing.', 'Dry wood, fair price. That is my rule.'],
  },
  {
    id: 'mill', name: 'Ilsa the Miller', wallet: 400,
    recipe: { in: { wheat: 3 }, out: { flour: 2 } },
    buys: { wheat: 3 }, sells: { flour: 6, plow: 30 },
    stock: { wheat: 9, flour: 4, plow: 2 }, target: { wheat: 12, flour: 6, plow: 2 },
    lines: ['The stones turn whether you bring wheat or not.', 'Bring me grain, I will make you flour.'],
  },
  {
    id: 'bakery', name: 'Tobin the Baker', wallet: 450,
    recipe: { in: { flour: 2, wood: 1 }, out: { bread: 4 } },
    buys: { flour: 6, wood: 3 }, sells: { bread: 6 },
    stock: { flour: 4, wood: 3, bread: 6 }, target: { flour: 6, wood: 4, bread: 8 },
    lines: ['Warm bread, warm village.', 'No flour, no bread. Simple as that.'],
  },
  {
    id: 'smithy', name: 'Doran the Blacksmith', wallet: 600,
    recipe: { in: { ore: 2, wood: 1 }, out: { sword: 1 } },
    buys: { ore: 6, wood: 3 }, sells: { sword: 45, pickaxe: 35 },
    stock: { ore: 4, wood: 2, sword: 2, pickaxe: 3 }, target: { ore: 8, wood: 3, sword: 3, pickaxe: 3 },
    lines: ['Iron in, steel out.', 'Dragon talk is good for business, I will admit.'],
  },
  {
    id: 'carpenter', name: 'Wren the Carpenter', wallet: 450,
    recipe: { in: { lumber: 2 }, out: { cart: 1 } },
    buys: { lumber: 9 }, sells: { cart: 30, bed: 18, rod: 12 },
    stock: { lumber: 2, cart: 1, bed: 3, rod: 3 }, target: { lumber: 4, cart: 2, bed: 3, rod: 3 },
    lines: ['Measure twice, cut once.', 'A good cart carries a family through winter.'],
  },
  {
    id: 'inn', name: 'Marta the Innkeeper', wallet: 500,
    recipe: { in: { bread: 1 }, out: { meal: 2 } },
    alt: { in: { fish: 2 }, out: { meal: 3 } }, // fish from the pond makes good meals too
    buys: { bread: 6, fish: 4 }, sells: { meal: 9 },
    stock: { bread: 4, meal: 2, fish: 0 }, target: { bread: 6, meal: 4, fish: 6 },
    lines: ['Travellers bring coin and stories.', 'Full tables mean a full purse.'],
  },
  {
    id: 'tailor', name: 'Selma the Tailor', wallet: 400,
    recipe: { in: { wool: 3 }, out: { coat: 1 } },
    buys: { wool: 3, ore: 6 }, sells: { coat: 26, shears: 22 },
    stock: { wool: 6, ore: 1, coat: 3, shears: 3 }, target: { wool: 9, ore: 2, coat: 4, shears: 3 },
    lines: ['Winter bites. A good coat bites back.', 'Bring me wool and I will keep the village warm.'],
  },
  {
    id: 'tower', name: 'Captain Hale', wallet: 700,
    recipe: null,
    buys: { sword: 47, bread: 7 },  sells: {},
    stock: { sword: 2, bread: 2 }, target: { sword: 4, bread: 4 },
    lines: ['The peak is quiet. For now.', 'A blade in every hand when the dragon comes.'],
  },
];

export const START_PATHS = {
  farmer:     { name: 'Farmer',     coins: 50, items: { plow: 1 } },
  miner:      { name: 'Miner',      coins: 50, items: { pickaxe: 1 } },
  woodcutter: { name: 'Woodcutter', coins: 50, items: { axe: 1 } },
  apprentice: { name: 'Apprentice', coins: 80, items: {} },
};

// Normal speed: one game day lasts 8 real minutes.
// Demo speed (npm run demo): one game day lasts 2 minutes, for recording videos.
const DEMO = process.env.EMBERWICK_DEMO === '1';

export const RULES = {
  demo: DEMO,
  tickMs: DEMO ? 4000 : 5000,      // time between simulation steps
  ticksPerDay: DEMO ? 30 : 96,     // steps in one game day
  droughtChance: DEMO ? 0.12 : 0.08, // chance per day
  dragonChance: DEMO ? 0.15 : 0.1,   // chance per day
  dragonWarningDays: DEMO ? 3 : 2,   // days between the warning and the attack
  daysBetweenAttacks: DEMO ? 1 : 3,
  taxRate: 0.03,         // market tax to the treasury
  energyMax: 10,
  breadEnergy: 3,
  energyCap: 20,          // max energy grows with level, up to this
  levelXp: [0, 8, 20, 40, 65, 100], // xp needed for level 1..6
  tradeBonus: 0.03,       // craftsmen pay 3% more per trading level above 1
  toolUses: 30,           // a tool breaks after this many uses
  mealEnergy: 5,
  energyPerTick: DEMO ? 0.2 : 0.15,   // energy comes back slowly; food and sleep help
  guardSalaryPerDay: 25, // paid from the treasury
  treasuryReserve: 2000, // treasury never goes below this
  priceStep: DEMO ? 0.12 : 0.06,  // how fast prices move toward their supply-and-demand level
  profitTaxAbove: 800,   // shops richer than this pay a profit tax
  profitTaxRate: 0.2,
  minPrice: 1,
  // nights and winter
  innBed: 5,             // a bed for the night at the inn, paid to the innkeeper
  innRooms: 4,           // the inn has four rooms; travellers take some of them each night
  sleepRegen: 3,         // energy comes back this many times faster while you sleep indoors
  coldMaxEnergy: 3,      // after a night outside your energy cannot fill up as high the next day
  winterNoCoatCost: 1,   // extra energy for outdoor work in winter without a coat
  winterNightDrain: 0.08, // energy lost per step on a winter night outside without a coat
  coatWinterDays: 6,     // a coat lasts this many winter days
};

// Apprentice jobs: craftsmen post an offer each day if they can afford it.
// Wages are paid per shift, straight from the craftsman's wallet.
// While under contract the player works only for their employer (no gathering).
export const JOBS = {
  wageBase: { smithy: 12, carpenter: 12, bakery: 8, mill: 9, woodcutter: 9, inn: 7, tower: 9, tailor: 8 },
  // experience a shop asks for. Shops without an entry take beginners.
  require: { smithy: { skill: 'mining', level: 2 }, mill: { skill: 'farming', level: 2 }, woodcutter: { skill: 'woodcutting', level: 2 }, carpenter: { skill: 'woodcutting', level: 3 } },
  signingBonus: 1,       // paid by the employer when the contract is signed; the contract terms go on NEAR with it
  coolDownDays: 2,       // after quitting early, shops will not hire you for this many days
  days: 3,               // length of a contract in game days
  shiftEnergy: 3,        // energy one shift costs
  shiftsPerDay: 3,       // an apprentice works only at their shop, up to this many shifts a day
  severanceDays: 1,      // wages paid if the employer ends the contract early
  noticeShifts: 1,       // wages the apprentice pays the employer for quitting early
  reserve: 100,          // a craftsman keeps this much before hiring
};

// The village council. Anyone in the village can propose one of these kinds of
// decisions; players, bot villagers and the AI craftsmen vote. Vote weight mixes
// wealth (square root, so the rich cannot simply buy every vote), how long you have
// lived here and what you have given to the village.
export const COUNCIL = {
  kinds: ['grant', 'tax', 'welcome', 'festival', 'tower', 'district'],
  fee: 2,                  // proposing costs this much, paid to the treasury (stops spam)
  maxOpen: 3,              // open proposals at once
  quorum: 4,               // a decision needs at least this many voters
  grant: { min: 50, max: 400 },     // treasury -> one craftsman (e.g. sword money for the tower)
  tax: { min: 0.01, max: 0.06 },    // market tax rate
  welcome: { min: 100, max: 800 },  // treasury -> newcomer fund
  festival: { min: 2, max: 10 },    // treasury -> every villager, per head
  tower: { cost: 250, readiness: 10, spots: ['watch-1', 'watch-2', 'watch-3'] }, // treasury pays the carpenter to build a watchtower
  weight: { wealth: 0.5, residencyCap: 10, contributionCap: 10 },
};

// Land: a player buys a plot from the village (the money goes to the treasury) and
// gets a deed, an NFT on NEAR. On their own plot they can build a home with lumber
// and the carpenter's work. Their own home needs no rent.
export const LAND = {
  plots: ['plot-1', 'plot-2', 'plot-3', 'plot-4'], // the village plots; district plots are added as districts open
  price: 120,                 // base price; each plot multiplies it by its factor
  lease: { min: 3, max: 30 }, // daily rent an owner may ask for their home                 // EMWK to the treasury
  build: { lumber: 6, fee: 40, builder: 'carpenter' },
  rest: 99,                   // sleeping in your own home fills your energy
};

// Homes are owned by the village. Rent goes to the treasury every day.
export const HOUSES = {
  'house-1': { size: 'room',  rent: 6,  deposit: 12, rest: 6 },
  'house-2': { size: 'small', rent: 10, deposit: 20, rest: 10 },
  'house-3': { size: 'large', rent: 16, deposit: 32, rest: 99 }, // a full night's sleep
};

// Where each starting path gathers and who buys what they gather.
export const PATH_ROUTE = {
  farmer:     { spot: 'fields', shop: 'mill' },
  miner:      { spot: 'mine',   shop: 'smithy' },
  woodcutter: { spot: 'forest', shop: 'woodcutter' },
  apprentice: { spot: 'forest', shop: 'woodcutter' },
};

// The newcomer's first goals. `target` tells the map which building to highlight.
// Rewards come from the newcomer fund, so the money supply stays fixed.
export const QUESTS = [
  { id: 'meet',   title: 'Meet Elder Rowan', text: 'Walk to the village gate and hear what the elder has to say.', target: 'gate', reward: 5 },
  { id: 'gather', title: 'Your first work', text: 'Gather at the {spot} two times.', target: '{spot}', reward: 5 },
  { id: 'sell',   title: 'Make a sale', text: 'Sell what you gathered to the {shop}.', target: '{shop}', reward: 10 },
  { id: 'peak',   title: 'Know the danger', text: 'Look at Dragon peak to see how ready the village is.', target: 'dragonpeak', reward: 5 },
  { id: 'earn',   title: 'Stand on your own feet', text: 'Earn 40 EMWK from trading.', target: '{shop}', reward: 10 },
  { id: 'supply', title: 'Feed the village', text: 'Sell 15 goods in total to the craftsmen.', target: 'market', reward: 15 },
  { id: 'done',   title: 'A true villager', text: 'Jobs, homes and the village council open in the next update. Keep trading and watch the prices.', target: null, reward: 0 },
];

// Which skill each raw good trains.
export const SKILL_OF = { wheat: 'farming', wood: 'woodcutting', ore: 'mining', wool: 'farming', fish: 'farming' };
export const SKILLS = ['farming', 'woodcutting', 'mining', 'trading'];
