// Static definition of the Emberwick world.
// Every building, good and craftsman has a fixed id. Saved game data refers to
// these ids, so the visual layer can be redrawn later without touching anyone's
// property.

export const TOKEN = { symbol: 'EMWK', totalSupply: 25000 };

// How the fixed supply is split at genesis. Money never appears from nowhere:
// it only moves between these accounts and players.
export const GENESIS = {
  treasury: 10000,
  newcomerFund: 5000,
  adventurerFund: 5000,
  botFund: 1500,
  craftsmen: 3500,
};

export const GOODS = {
  wheat:   { name: 'Wheat',     kind: 'raw' },
  wood:    { name: 'Wood',      kind: 'raw' },
  ore:     { name: 'Iron ore',  kind: 'raw' },
  lumber:  { name: 'Lumber',    kind: 'made' },
  flour:   { name: 'Flour',     kind: 'made' },
  bread:   { name: 'Bread',     kind: 'made' },
  sword:   { name: 'Sword',     kind: 'made' },
  pickaxe: { name: 'Pickaxe',   kind: 'tool', boosts: 'ore' },
  axe:     { name: 'Axe',       kind: 'tool', boosts: 'wood' },
  plow:    { name: 'Plow',      kind: 'tool', boosts: 'wheat' },
  cart:    { name: 'Cart',      kind: 'tool', boosts: 'carry' },
  meal:    { name: 'Meal',      kind: 'service' },
};

// Places the player can gather raw goods from.
export const GATHER_SPOTS = {
  forest: { good: 'wood',  energy: 2, base: 3 },
  fields: { good: 'wheat', energy: 2, base: 4 },
  mine:   { good: 'ore',   energy: 3, base: 2 },
};

// Map layout on a 12x12 isometric grid. (i, j) = grid cell, w = footprint.
export const BUILDINGS = [
  { id: 'forest',     name: 'Forest',      type: 'gather',    i: 0,  j: 1,  w: 3 },
  { id: 'fields',     name: 'Fields',      type: 'gather',    i: 1,  j: 5,  w: 3 },
  { id: 'mine',       name: 'Mine',        type: 'gather',    i: 9,  j: 2,  w: 2 },
  { id: 'dragonpeak', name: 'Dragon peak', type: 'landmark',  i: 10, j: 0,  w: 2 },
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
  { id: 'gate',       name: 'Village gate',type: 'landmark',  i: 5,  j: 11, w: 1 },
  { id: 'expansion',  name: 'Expansion land', type: 'future', i: 0,  j: 10, w: 2 },
];

// The seven craftsmen. They are AI agents with their own wallets.
// recipe: inputs consumed -> outputs produced, once per production step.
// buys/sells: starting prices in EMWK. target: stock level they aim for.
export const CRAFTSMEN = [
  {
    id: 'woodcutter', name: 'Bram the Woodcutter', wallet: 400,
    recipe: { in: { wood: 2 }, out: { lumber: 1 } },
    buys: { wood: 3 }, sells: { lumber: 8, axe: 16 },
    stock: { wood: 6, lumber: 4, axe: 3 }, target: { wood: 10, lumber: 6, axe: 3 },
    lines: ['Good timber keeps a village standing.', 'Dry wood, fair price. That is my rule.'],
  },
  {
    id: 'mill', name: 'Ilsa the Miller', wallet: 400,
    recipe: { in: { wheat: 3 }, out: { flour: 2 } },
    buys: { wheat: 2 }, sells: { flour: 5, plow: 22 },
    stock: { wheat: 9, flour: 4, plow: 2 }, target: { wheat: 12, flour: 6, plow: 2 },
    lines: ['The stones turn whether you bring wheat or not.', 'Bring me grain, I will make you flour.'],
  },
  {
    id: 'bakery', name: 'Tobin the Baker', wallet: 450,
    recipe: { in: { flour: 2, wood: 1 }, out: { bread: 4 } },
    buys: { flour: 6, wood: 3 }, sells: { bread: 5 },
    stock: { flour: 4, wood: 3, bread: 6 }, target: { flour: 6, wood: 4, bread: 8 },
    lines: ['Warm bread, warm village.', 'No flour, no bread. Simple as that.'],
  },
  {
    id: 'smithy', name: 'Doran the Blacksmith', wallet: 600,
    recipe: { in: { ore: 2, wood: 1 }, out: { sword: 1, pickaxe: 1 } },
    buys: { ore: 6, wood: 3 }, sells: { sword: 40, pickaxe: 18 },
    stock: { ore: 4, wood: 2, sword: 2, pickaxe: 3 }, target: { ore: 8, wood: 3, sword: 3, pickaxe: 3 },
    lines: ['Iron in, steel out.', 'Dragon talk is good for business, I will admit.'],
  },
  {
    id: 'carpenter', name: 'Wren the Carpenter', wallet: 450,
    recipe: { in: { lumber: 2 }, out: { cart: 1 } },
    buys: { lumber: 9 }, sells: { cart: 30 },
    stock: { lumber: 2, cart: 1 }, target: { lumber: 4, cart: 2 },
    lines: ['Measure twice, cut once.', 'A good cart carries a family through winter.'],
  },
  {
    id: 'inn', name: 'Marta the Innkeeper', wallet: 500,
    recipe: { in: { bread: 1 }, out: { meal: 2 } },
    buys: { bread: 6 }, sells: { meal: 7 },
    stock: { bread: 4, meal: 2 }, target: { bread: 6, meal: 4 },
    lines: ['Travellers bring coin and stories.', 'Full tables mean a full purse.'],
  },
  {
    id: 'tower', name: 'Captain Hale', wallet: 700,
    recipe: null,
    buys: { sword: 42, bread: 6 }, sells: {},
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

export const RULES = {
  tickMs: 4000,          // one tick every 4 real seconds
  ticksPerDay: 30,       // one game day = 2 real minutes
  taxRate: 0.03,         // market tax to the treasury
  energyMax: 10,
  energyPerTick: 0.25,
  guardSalaryPerDay: 25, // paid from the treasury
  treasuryReserve: 2000, // treasury never goes below this
  priceStep: 0.06,       // how fast prices react
  profitTaxAbove: 800,   // shops richer than this pay a profit tax
  profitTaxRate: 0.2,
  minPrice: 1,
};
