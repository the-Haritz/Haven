// Sets up the wallet client for the central hot wallet.
// Instead of sending payouts from individual user deposit wallets (which would mean
// funding gas on every single EOA), we sweep them to this hot wallet first and payout from here.
// Note: Config validates that production does not use test keys.

import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { config } from './config';

export const hotWalletAccount = privateKeyToAccount(
  config.hotWalletPrivateKey as `0x${string}`
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const hotWalletClient: any = createWalletClient({
  account: hotWalletAccount,
  chain: baseSepolia,
  transport: http(config.rpcUrl),
});
