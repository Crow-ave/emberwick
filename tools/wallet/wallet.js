// Emberwick browser wallet bridge: Meteor Wallet through NEAR Wallet Selector.
// Built into public/vendor/near-wallet.js (see tools/build-wallet.sh).
import { Buffer } from 'buffer';
import { setupWalletSelector, actionCreators } from '@near-wallet-selector/core';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';

let selector = null, net = null;
async function wallet(network) {
  if (!selector || net !== network) {
    net = network;
    selector = await setupWalletSelector({ network, modules: [setupMeteorWallet()] });
  }
  return selector.wallet('meteor-wallet');
}

// wallets answer in slightly different shapes; find the transaction hash in any of them
function findHash(out) {
  if (!out) return null;
  if (typeof out === 'string') return out;
  if (Array.isArray(out)) return findHash(out[0]);
  return (out.transaction && out.transaction.hash) || (out.transaction_outcome && out.transaction_outcome.id) ||
    out.transactionHash || out.hash || (out.final_execution_outcome && findHash(out.final_execution_outcome)) || null;
}

window.EmberwickWallet = {
  async signIn(network, contractId) {
    const w = await wallet(network);
    const accounts = await w.signIn({ contractId, methodNames: [] });
    return accounts && accounts[0] ? accounts[0].accountId : null;
  },
  async accountId(network) {
    const w = await wallet(network);
    const accounts = await w.getAccounts();
    return accounts && accounts[0] ? accounts[0].accountId : null;
  },
  async signOut(network) {
    const w = await wallet(network);
    await w.signOut();
  },
  // NEP-413: proves this player owns the account, nothing is sent on chain
  async signMessage(network, { message, recipient, nonce }) {
    const w = await wallet(network);
    return w.signMessage({ message, recipient, nonce: Buffer.from(nonce, 'base64') });
  },
  // the player signs an ft_transfer of EMWK in their own wallet
  async ftTransfer(network, tokenId, receiverId, amount, memo) {
    const w = await wallet(network);
    const out = await w.signAndSendTransaction({
      receiverId: tokenId,
      actions: [actionCreators.functionCall('ft_transfer', { receiver_id: receiverId, amount: String(amount), memo }, 30000000000000n, 1n)],
    });
    return findHash(out);
  },
  // the player sends their land-deed NFT (e.g. to the village bank, to put it up for sale)
  async nftTransfer(network, contractId, receiverId, tokenId, memo) {
    const w = await wallet(network);
    const out = await w.signAndSendTransaction({
      receiverId: contractId,
      actions: [actionCreators.functionCall('nft_transfer', { receiver_id: receiverId, token_id: tokenId, memo }, 30000000000000n, 1n)],
    });
    return findHash(out);
  },
};
