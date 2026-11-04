// How the AI craftsmen set their prices. All the pricing rules live in this one file.
//
// Every craftsman has a stock level they aim for (the "target") for each good. The target itself
// moves: it doubles for firewood in winter, triples for swords when the dragon wakes, follows what
// the craftsman learned about demand, and grows with the workshop level (see targetFor in economy.js).
//
// 1. The price a craftsman aims for depends on how far the stock is from the target:
//      buy price  = base × (target / stock) ^ 0.8   (between 0.4× and 4× the base)
//      sell price = base × (target / stock) ^ 0.6   (between 0.5× and 4×; tools never below 0.8×)
//    Short of something → they pay more for it and charge more for it. Full stores → the opposite.
// 2. Prices do not jump: every step they move 6% of the way towards that level (12% in demo mode).
// 3. Selling many units at once: each extra unit is priced as if the stock were already one higher,
//    so the 10th wool is worth less to the tailor than the 1st, and they stop at twice the target.
// 4. Players with trading skill get +3% per level on what craftsmen pay them.

export const CURVE = { buy: 0.8, sell: 0.6 };
export const RANGE = { buy: [0.4, 4], sell: [0.5, 4], toolFloor: 0.8 };
export const WANT_FACTOR = 2; // a craftsman buys until the stock is twice the target

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// the price a craftsman aims for, given stock and target
export function levelPrice(base, stock, target, side, isTool = false) {
  const t = Math.max(1, target), s = Math.max(stock, 0.5);
  const [lo, hi] = RANGE[side];
  return base * clamp(Math.pow(t / s, CURVE[side]), side === 'sell' && isTool ? RANGE.toolFloor : lo, hi);
}

// one step of the price moving towards its level
export const stepTowards = (now, level, step) => now + (level - now) * step;

// the reasons behind a price, as keys the game shows in the craftsman's tooltip
export function priceReasons({ stock, target, baseTarget, learned, level, winter, dragon, drought, good, npc }) {
  const r = [];
  const ratio = stock / Math.max(1, target);
  if (ratio < 0.6) r.push('short'); else if (ratio > 1.4) r.push('plenty'); else r.push('balanced');
  if (winter && ((npc === 'bakery' && good === 'wood') || (npc === 'tailor' && (good === 'coat' || good === 'wool')))) r.push('winter');
  if (dragon && ((npc === 'tower' && good === 'sword') || (npc === 'smithy' && good === 'ore'))) r.push('dragon');
  if (drought && (good === 'wheat' || good === 'flour' || good === 'bread')) r.push('drought');
  if (learned && learned > 1.15) r.push('learnedMore'); else if (learned && learned < 0.85) r.push('learnedLess');
  if (level > 1) r.push('bigWorkshop');
  return r;
}
