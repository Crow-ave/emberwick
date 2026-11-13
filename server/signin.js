// Sign in with a wallet from any chain: the player signs a one-time message in Phantom (Solana), MetaMask or
// another EVM wallet, or a NEAR wallet (NEP-413), and the character is tied to that address. On another
// device the same wallet signs a new message and the character comes back. No password, no e-mail, and the
// game never sees a key: only a signature over a message that names the site, the address and a fresh nonce.
import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { recoverEip191 } from './ai.js';

export const CHAINS = ['near', 'evm', 'sol'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58decode(s) {
  let n = 0n;
  for (const c of String(s)) { const i = B58.indexOf(c); if (i < 0) throw new Error('not base58'); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of String(s)) { if (c !== '1') break; out.unshift(0); }
  return new Uint8Array(out);
}

// the address, normalised: EVM in lower case; Solana a 32-byte base58 key; NEAR an account name
export function normAddress(chain, a) {
  a = String(a || '').trim();
  if (chain === 'evm') return /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null;
  if (chain === 'sol') { try { return b58decode(a).length === 32 ? a : null; } catch { return null; } }
  if (chain === 'near') return /^[a-z0-9._-]{2,64}$/.test(a) ? a : null;
  return null;
}

export function signinMessage({ chain, address, purpose, name, nonce, host }) {
  return [
    `Emberwick: ${purpose === 'link' ? `let this wallet sign in as ${name}` : 'sign in to my villager'}`,
    `Site: ${host}`,
    `Wallet (${chain === 'evm' ? 'EVM' : chain === 'sol' ? 'Solana' : 'NEAR'}): ${address}`,
    `Nonce: ${nonce}`,
    'This only proves you own the wallet. It moves no money and costs nothing.',
  ].join('\n');
}

// EVM: personal_sign (EIP-191), the signature must recover to the address
export function verifyEvm(message, sig, address) {
  try { return recoverEip191(message, sig) === address.toLowerCase(); } catch { return false; }
}
// Solana: signMessage gives an ed25519 signature over the message bytes, by the wallet's public key (= address)
export function verifySol(message, sig, address) {
  try {
    let s = null;
    try { s = new Uint8Array(Buffer.from(String(sig), 'base64')); } catch { /* not base64 */ }
    if (!s || s.length !== 64) s = b58decode(sig);
    return s.length === 64 && ed25519.verify(s, new TextEncoder().encode(message), b58decode(address));
  } catch { return false; }
}

// one-time challenges, kept for ten minutes
export class Challenges {
  constructor() { this.m = new Map(); }
  make(fields) {
    const nonce = crypto.randomBytes(32).toString('base64');
    if (this.m.size > 5000) for (const [k, v] of this.m) if (Date.now() - v.at > 600000) this.m.delete(k);
    this.m.set(nonce, { ...fields, nonce, at: Date.now() });
    return this.m.get(nonce);
  }
  take(nonce) {
    const c = this.m.get(String(nonce || ''));
    this.m.delete(String(nonce || ''));
    return c && Date.now() - c.at < 600000 ? c : null;
  }
}
