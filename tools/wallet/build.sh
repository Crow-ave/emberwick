#!/bin/sh
# Rebuilds public/vendor/near-wallet.js (Meteor Wallet through NEAR Wallet Selector).
# Only needed if you change tools/wallet/wallet.js. Run from the project folder.
set -e
cd "$(dirname "$0")"
npm init -y >/dev/null 2>&1 || true
npm i --no-save @near-wallet-selector/core@10.1.4 @near-wallet-selector/meteor-wallet@10.1.4 buffer@6 util@0.12 esbuild@0.28.2
npx esbuild wallet.js --bundle --minify --format=iife --platform=browser --target=es2020 --inject:shim.js --define:global=window --outfile=../../public/vendor/near-wallet.js
