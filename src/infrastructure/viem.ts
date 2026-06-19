// Shared read-only public client.
// Used for querying balances, gas estimation, and fetching transaction receipts.

import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { config } from './config';

// Uses public RPC endpoint unless overridden in env
const transport = http(config.rpcUrl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const publicClient: any = createPublicClient({
  chain: baseSepolia,
  transport,
});
