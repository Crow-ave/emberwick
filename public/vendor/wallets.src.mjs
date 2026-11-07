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
import { getWallets } from '@wallet-standard/app';
import bs58 from 'bs58';
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

// several deposits in ONE transaction (one approval): register each address, wrap the total once, send each part.
// Gas is kept small per action so up to 5 parts fit in one transaction (the limit is 300 TGas).
export async function nearSendMany(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 5) throw new Error('1 to 5 parts');
  const s = await near();
  const me = await nearAccount();
  if (!me) throw new Error('connect a NEAR wallet first');
  const units = parts.map((p) => BigInt(toUnits(p.amount, 24)));
  const total = units.reduce((a, b) => a + b, 0n);
  const fc = (methodName, args, deposit, gas) => ({ type: 'FunctionCall', params: { methodName, args, gas, deposit } });
  const G10 = '10000000000000', G15 = '15000000000000';
  const actions = [fc('storage_deposit', { account_id: me, registration_only: true }, STORAGE, G10)];
  for (const p of parts) actions.push(fc('storage_deposit', { account_id: p.depositAddress, registration_only: true }, STORAGE, G10));
  actions.push(fc('near_deposit', {}, total.toString(), G10));
  parts.forEach((p, i) => actions.push(fc('ft_transfer', { receiver_id: p.depositAddress, amount: units[i].toString(), memo: 'Emberwick split ' + (i + 1) }, '1', G15)));
  const w = await s.wallet();
  const out = await w.signAndSendTransaction({ signerId: me, receiverId: WRAP, actions });
  return out && out.transaction ? out.transaction.hash : null;
}

// any other NEAR token (NEP-141): register the deposit address on that token, then send it
export async function nearSendFt(contract, depositAddress, amount, decimals) {
  const s = await near();
  const me = await nearAccount();
  if (!me) throw new Error('connect a NEAR wallet first');
  const units = toUnits(amount, decimals);
  const fc = (methodName, args, deposit) => ({ type: 'FunctionCall', params: { methodName, args, gas: TGAS, deposit } });
  const w = await s.wallet();
  const out = await w.signAndSendTransaction({ signerId: me, receiverId: contract, actions: [
    fc('storage_deposit', { account_id: depositAddress, registration_only: true }, STORAGE),
    fc('ft_transfer', { receiver_id: depositAddress, amount: units, memo: 'Emberwick swap' }, '1'),
  ] });
  return out && out.transaction ? out.transaction.hash : null;
}

// ---------- Solana: any installed wallet (Wallet Standard: Phantom, Solflare, Backpack, ...) ----------
const legacySol = () => (window.phantom && window.phantom.solana) || window.solana || null;
const std = getWallets();
const solStd = () => std.get().filter((w) => (w.chains || []).some((c) => String(c).startsWith('solana:')) && w.features && w.features['standard:connect'] && w.features['solana:signAndSendTransaction']);
let solPick = null;
export function solWallets() {
  const list = solStd().map((w) => ({ id: 'std:' + w.name, name: w.name }));
  if (!list.length && legacySol()) list.push({ id: 'legacy', name: legacySol().isPhantom ? 'Phantom' : 'Solana wallet' });
  return list;
}
export const hasSolana = () => solWallets().length > 0;
export async function solConnect(id) {
  const list = solWallets();
  const pick = id || (list[0] && list[0].id);
  if (!pick) throw new Error('no Solana wallet in this browser');
  if (pick.startsWith('std:')) {
    const w = solStd().find((x) => 'std:' + x.name === pick);
    if (!w) throw new Error('wallet not found');
    const r = await w.features['standard:connect'].connect();
    const acc = ((r && r.accounts) || w.accounts || [])[0];
    if (!acc) throw new Error('no account');
    solPick = { kind: 'std', wallet: w, account: acc };
    return id ? { address: acc.address, name: w.name } : acc.address;
  }
  const p = legacySol();
  if (!p) throw new Error('no Solana wallet in this browser');
  const r = await p.connect();
  solPick = { kind: 'legacy' };
  const address = (r && r.publicKey ? r.publicKey : p.publicKey).toString();
  return id ? { address, name: p.isPhantom ? 'Phantom' : 'Solana wallet' } : address;
}
// forget this site in the wallet, so the next connect can pick another wallet or account
export async function solDisconnect() {
  try {
    if (solPick && solPick.kind === 'std') { const d = solPick.wallet.features['standard:disconnect']; if (d) await d.disconnect(); }
    else { const p = legacySol(); if (p && p.disconnect) await p.disconnect(); }
  } catch { /* already gone */ }
  solPick = null;
}
async function solSign(tx) {
  if (solPick && solPick.kind === 'std') {
    const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const [out] = await solPick.wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({ account: solPick.account, transaction: bytes, chain: 'solana:mainnet' });
    return bs58.encode(out.signature);
  }
  const p = legacySol();
  const r = await p.signAndSendTransaction(tx);
  return r && r.signature ? r.signature : String(r || '');
}
function solFrom() {
  if (solPick && solPick.kind === 'std') return new PublicKey(solPick.account.address);
  const p = legacySol();
  if (!p || !p.publicKey) throw new Error('connect a Solana wallet first');
  return new PublicKey(p.publicKey.toString());
}
// the game's server gives a fresh blockhash (browsers are often blocked by public Solana RPCs)
export async function solSend(depositAddress, sym, amount, blockhash) {
  return solSendAny(depositAddress, sym === 'SOL' ? null : USDC_SOL.toString(), amount, sym === 'SOL' ? 9 : 6, blockhash);
}
// any Solana token: the chain's own SOL (mint = null) or an SPL token by its mint
export async function solSendAny(depositAddress, mint, amount, decimals, blockhash) {
  if (!solPick && !legacySol()) throw new Error('no Solana wallet in this browser');
  const from = solFrom(), to = new PublicKey(depositAddress);
  const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash });
  if (!mint) tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: BigInt(toUnits(amount, 9)) }));
  else {
    const m = new PublicKey(mint), fromAta = getAssociatedTokenAddressSync(m, from), toAta = getAssociatedTokenAddressSync(m, to, true);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, m));
    tx.add(createTransferCheckedInstruction(fromAta, m, toAta, from, BigInt(toUnits(amount, decimals)), decimals));
  }
  return solSign(tx);
}

// ---------- Base (MetaMask, Coinbase Wallet or any window.ethereum) ----------
const evmFound = new Map();
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => { const d = e.detail; if (d && d.info && d.provider) evmFound.set(d.info.uuid, d); });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}
let evmPick = null;
const injectedName = () => { const e = window.ethereum; return !e ? null : e.isRabby ? 'Rabby' : e.isCoinbaseWallet ? 'Coinbase Wallet' : e.isMetaMask ? 'MetaMask' : 'Browser wallet'; };
// every EVM wallet installed in this browser (EIP-6963: MetaMask, Rabby, Coinbase Wallet, ...)
export function evmWallets() {
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const list = [...evmFound.values()].map((d) => ({ id: d.info.uuid, name: d.info.name }));
  if (!list.length && window.ethereum) list.push({ id: 'injected', name: injectedName() });
  return list;
}
const eth = () => (evmPick && evmPick.provider) || window.ethereum || null;
export const hasEvm = () => evmWallets().length > 0;

export async function evmConnect(id) {
  if (id) {
    const d = id === 'injected' ? { provider: window.ethereum, info: { name: injectedName() } } : evmFound.get(id);
    if (!d || !d.provider) throw new Error('wallet not found');
    evmPick = { provider: d.provider, name: d.info.name };
  }
  const e = eth();
  if (!e) throw new Error('no EVM wallet in this browser');
  const [a] = await e.request({ method: 'eth_requestAccounts' });
  return id ? { address: a, name: evmPick.name } : a;
}
// MetaMask can drop this site's permission, so the next connect shows the account list again
export async function evmDisconnect() { const e = eth(); try { if (e) await e.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }); } catch { /* older wallets: just forget it here */ } evmPick = null; }
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
  const from = (await e.request({ method: 'eth_requestAccounts' }))[0];
  await onBase(e);
  const pad = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const data = '0xa9059cbb' + pad(depositAddress) + pad(BigInt(toUnits(amount, 6)).toString(16)); // transfer(address,uint256)
  return e.request({ method: 'eth_sendTransaction', params: [{ from, to: USDC_BASE, data, value: '0x0' }] });
}

// any EVM chain: switch the wallet to it (adding it if the wallet does not know it), then send the coin or an ERC-20
const EVM_META = {
  1: ['Ethereum', 'ETH', 'https://eth.llamarpc.com', 'https://etherscan.io'],
  8453: ['Base', 'ETH', 'https://mainnet.base.org', 'https://basescan.org'],
  42161: ['Arbitrum One', 'ETH', 'https://arb1.arbitrum.io/rpc', 'https://arbiscan.io'],
  10: ['OP Mainnet', 'ETH', 'https://mainnet.optimism.io', 'https://optimistic.etherscan.io'],
  137: ['Polygon', 'POL', 'https://polygon-rpc.com', 'https://polygonscan.com'],
  56: ['BNB Smart Chain', 'BNB', 'https://bsc-dataseed.binance.org', 'https://bscscan.com'],
  43114: ['Avalanche C-Chain', 'AVAX', 'https://api.avax.network/ext/bc/C/rpc', 'https://snowtrace.io'],
  100: ['Gnosis', 'xDAI', 'https://rpc.gnosischain.com', 'https://gnosisscan.io'],
  80094: ['Berachain', 'BERA', 'https://rpc.berachain.com', 'https://berascan.com'],
};
async function onChain(e, chainId) {
  const hex = '0x' + Number(chainId).toString(16);
  try { await e.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }); }
  catch (err) {
    const m = EVM_META[chainId];
    if (err && err.code === 4902 && m) await e.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: m[0], nativeCurrency: { name: m[1], symbol: m[1], decimals: 18 }, rpcUrls: [m[2]], blockExplorerUrls: [m[3]] }] });
    else throw err;
  }
}
export async function evmSendAny(chainId, token, depositAddress, amount, decimals) {
  const e = eth();
  if (!e) throw new Error('no EVM wallet in this browser');
  if (!/^0x[0-9a-fA-F]{40}$/.test(depositAddress)) throw new Error('bad deposit address');
  const from = (await e.request({ method: 'eth_requestAccounts' }))[0];
  await onChain(e, chainId);
  const units = BigInt(toUnits(amount, decimals));
  if (!token) return e.request({ method: 'eth_sendTransaction', params: [{ from, to: depositAddress, value: '0x' + units.toString(16) }] });
  const pad = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const data = '0xa9059cbb' + pad(depositAddress) + pad(units.toString(16));
  return e.request({ method: 'eth_sendTransaction', params: [{ from, to: token, data, value: '0x0' }] });
}
