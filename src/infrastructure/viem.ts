import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

// I'm using Base Sepolia for the MVP so I can test with fake ETH.
// In production, this would be determined by an environment variable.
const chain = baseSepolia;

// Fallback to public RPC if no Alchemy/Infura URL is provided
const transport = http(process.env.RPC_URL || 'https://sepolia.base.org');

export const publicClient = createPublicClient({
  chain,
  transport,
});
