// Centralized config. Instead of doing process.env.SOMETHING || 'fallback' all over the place,
// we parse and validate everything once at boot.
//
// Rules:
// - Dev/Test: allow fallbacks (so npm run dev / test just works)
// - Prod: throw immediately if something critical is missing or using insecure local defaults.

import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(
      `❌ Missing required environment variable: ${key}. ` +
      `Set it in your .env file or environment.`
    );
  }
  // Don't let default dev keys leak into production
  if (isProduction && fallback && value === fallback) {
    throw new Error(
      `❌ Environment variable ${key} is using an insecure default value. ` +
      `This is not allowed in production.`
    );
  }
  return value;
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  logLevel: process.env.LOG_LEVEL || 'info',

  // Database
  databaseUrl: requireEnv('DATABASE_URL', 'file:./dev.db'),

  // Blockchain
  rpcUrl: requireEnv('RPC_URL', 'https://sepolia.base.org'),
  chainId: parseInt(process.env.CHAIN_ID || '84532', 10), // Base Sepolia

  // HD Wallet
  masterMnemonic: requireEnv(
    'MASTER_MNEMONIC',
    'test test test test test test test test test test test junk'
  ),

  // Hot Wallet
  hotWalletPrivateKey: requireEnv(
    'HOT_WALLET_PRIVATE_KEY',
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  ),
  hotWalletAddress: requireEnv(
    'HOT_WALLET_ADDRESS',
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  ),

  // Sweeper
  minSweepThreshold: process.env.MIN_SWEEP_THRESHOLD || '0.005', // in ETH

  // Block Explorer (for withdrawal responses)
  explorerBaseUrl: process.env.EXPLORER_BASE_URL || 'https://sepolia.basescan.org',
} as const;
