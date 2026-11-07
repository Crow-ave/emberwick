// Emberwick wallet bridge: connect the player's own wallets and send the deposit of a real NEAR Intents swap.
// Loaded only when a player presses "Connect wallet". The game never sees a key: every transfer is signed
// in the player's wallet, which shows the amount and the address before they approve.
import { Buffer } from 'buffer';
globalThis.Buffer = globalThis.Buffer || Buffer;
import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from '@solana/spl-token';

const WRAP = 'wrap.near';
const TGAS = '30000000000000';
const STORAGE = '1250000000000000000000'; // 0.00125 NEAR, refunded if the account is already registered
const USDC_SOL = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_CHAIN = '0x2105';

// exact decimal -> integer string (no floating point): "0.3", 24 -> "300000000000000000000000"
export function toUnits(amount, decimals) {
  const [w, f = ''] = String(amount).trim().split('.');
  if (!/^\d+$/.test(w || '0') || !/^\d*$/.test(f)) throw new Error('bad amount');
  return (BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

// ---------- NEAR (Meteor, MyNearWallet) ----------
let selector = null, modal = null;
async function near() {
  if (!selector) {
    selector = await setupWalletSelector({ network: 'mainnet', modules: [setupMeteorWallet(), setupMyNearWallet()] });
    modal = setupModal(selector, { theme: 'light', description: 'Emberwick only asks your wallet to send the swap deposit you approve. It never holds your keys.' });
  }
  return selector;
}
export async function nearAccount() {
  const s = await near();
  const a = s.store.getState().accounts.find((x) => x.active) || s.store.getState().accounts[0];
  return a ? a.accountId : null;
}
export async function nearConnect() {
  const s = await near();
  const now = await nearAccount();
  if (now) return now;
  modal.show();
  return new Promise((resolve) => {
    const sub = s.store.observable.subscribe((st) => {
      const a = st.accounts[0];
      if (a) { sub.unsubscribe(); modal.hide(); resolve(a.accountId); }
    });
    modal.on('onHide', () => setTimeout(async () => { const a = await nearAccount(); if (!a) { sub.unsubscribe(); resolve(null); } }, 300));
  });
}
export async function nearDisconnect() {
  const s = await near();
  if (!s.isSignedIn()) return;
  const w = await s.wallet(); await w.signOut();
}
// one transaction to wrap.near: register the sender and the deposit address, wrap the NEAR, send it
export async function nearSend(depositAddress, amount) {
  const s = await near();
  const me = await nearAccount();
  if (!me) throw new Error('connect a NEAR wallet first');
  const units = toUnits(amount, 24);
  const fc = (methodName, args, deposit) => ({ type: 'FunctionCall', params: { methodName, args, gas: TGAS, deposit } });
  const w = await s.wallet();
  const out = await w.signAndSendTransaction({
    signerId: me, receiverId: WRAP,
    actions: [
      fc('storage_deposit', { account_id: me, registration_only: true }, STORAGE),
      fc('storage_deposit', { account_id: depositAddress, registration_only: true }, STORAGE),
      fc('near_deposit', {}, units),
      fc('ft_transfer', { receiver_id: depositAddress, amount: units, memo: 'Emberwick swap' }, '1'),
    ],
  });
  return out && out.transaction ? out.transaction.hash : null; // a wallet that goes to another page returns nothing here
}

// ---------- Solana (Phantom or any wallet that injects window.solana) ----------
const sol = () => (window.phantom && window.phantom.solana) || window.solana || null;
export const hasSolana = () => !!sol();
export async function solConnect() {
  const p = sol();
  if (!p) throw new Error('no Solana wallet in this browser');
  const r = await p.connect();
  return (r && r.publicKey ? r.publicKey : p.publicKey).toString();
}
// the game's server gives a fresh blockhash (browsers are often blocked by public Solana RPCs)
export async function solSend(depositAddress, sym, amount, blockhash) {
  const p = sol();
  if (!p) throw new Error('no Solana wallet in this browser');
  const pk = p.publicKey || (await p.connect()).publicKey;
  const from = new PublicKey(pk.toString()); // the wallet's own key object, as this library's type
  const to = new PublicKey(depositAddress);
  const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash });
  if (sym === 'SOL') tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: BigInt(toUnits(amount, 9)) }));
  else {
    const fromAta = getAssociatedTokenAddressSync(USDC_SOL, from), toAta = getAssociatedTokenAddressSync(USDC_SOL, to, true);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, USDC_SOL));
    tx.add(createTransferCheckedInstruction(fromAta, USDC_SOL, toAta, from, BigInt(toUnits(amount, 6)), 6));
  }
  const r = await p.signAndSendTransaction(tx);
  return r && r.signature ? r.signature : String(r || '');
}

// ---------- Base (MetaMask, Coinbase Wallet or any window.ethereum) ----------
const eth = () => window.ethereum || null;
export const hasEvm = () => !!eth();
export async function evmConnect() {
  const e = eth();
  if (!e) throw new Error('no Base wallet in this browser');
  const [a] = await e.request({ method: 'eth_requestAccounts' });
  return a;
}
async function onBase(e) {
  try { await e.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN }] }); }
  catch (err) {
    if (err && err.code === 4902) await e.request({ method: 'wallet_addEthereumChain', params: [{ chainId: BASE_CHAIN, chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }] });
    else throw err;
  }
}
export async function evmSendUsdc(depositAddress, amount) {
  const e = eth();
  if (!e) throw new Error('no Base wallet in this browser');
  if (!/^0x[0-9a-fA-F]{40}$/.test(depositAddress)) throw new Error('bad deposit address');
  const from = await evmConnect();
  await onBase(e);
  const pad = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const data = '0xa9059cbb' + pad(depositAddress) + pad(BigInt(toUnits(amount, 6)).toString(16)); // transfer(address,uint256)
  return e.request({ method: 'eth_sendTransaction', params: [{ from, to: USDC_BASE, data, value: '0x0' }] });
}
