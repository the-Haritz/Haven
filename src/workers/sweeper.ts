// Background worker to sweep funds from user deposit addresses to the hot wallet.
// We consolidate funds to maintain hot wallet liquidity and minimize our EOA attack surface.
// This is designed to run periodically (e.g. as a cron job). It sweeps wallets sequentially
// and logs failures without crashing the whole process.
//
// Note: We only sweep native ETH for this MVP to avoid complex gas-funding dependencies for ERC-20s.

import { config } from '../infrastructure/config';
import { formatEther, parseEther, createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { prisma } from '../infrastructure/db';
import { WalletService } from '../usecases/WalletService';
import { publicClient } from '../infrastructure/viem';
import { logger } from '../infrastructure/logger';
import { TransactionType, TransactionStatus } from '../domain/types';

const HOT_WALLET_ADDRESS = config.hotWalletAddress;

// Skip low balance addresses so we don't burn all the ETH on gas fees
const MIN_SWEEP_THRESHOLD = parseEther(config.minSweepThreshold);

const walletService = new WalletService();

async function sweep(): Promise<void> {
  logger.info('🧹 Starting Sweeper Worker...', {
    hotWallet: HOT_WALLET_ADDRESS,
    minThreshold: config.minSweepThreshold + ' ETH',
  });

  // Load wallets from the DB.
  // Note: For production scale, paginate or use a cursor.
  const wallets = await prisma.wallet.findMany();

  logger.info(`Found ${wallets.length} wallets to check`);

  let sweptCount = 0;
  let skippedCount = 0;

  for (const wallet of wallets) {
    try {
      // Get actual on-chain balance (not our database record)
      const balance = await publicClient.getBalance({
        address: wallet.address as `0x${string}`,
      });

      if (balance < MIN_SWEEP_THRESHOLD) {
        skippedCount++;
        continue;
      }

      logger.info('Wallet has sweepable balance', {
        address: wallet.address,
        balance: formatEther(balance) + ' ETH',
      });

      // Get temporary memory account signer
      const account = walletService.getSignerForWallet(wallet.derivationIndex);

      // EIP-1559 Dynamic Gas Calculation.
      // Standard ETH transfer uses exactly 21,000 gas. We subtract total gas cost
      // from the on-chain balance to figure out the final sweep amount.
      const gasLimit = 21000n;
      const feeData = await publicClient.estimateFeesPerGas();

      const maxFeePerGas = feeData.maxFeePerGas || 0n;
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 0n;

      const maxGasCost = gasLimit * maxFeePerGas;
      const sweepAmount = balance - maxGasCost;

      if (sweepAmount <= 0n) {
        logger.warn('Balance too low after gas estimation, skipping', {
          address: wallet.address,
          balance: formatEther(balance) + ' ETH',
          estimatedGas: formatEther(maxGasCost) + ' ETH',
        });
        skippedCount++;
        continue;
      }

      logger.info('Sweeping funds to Hot Wallet', {
        address: wallet.address,
        sweepAmount: formatEther(sweepAmount) + ' ETH',
      });

      // Set up a temporary wallet client using the user's derived key
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(config.rpcUrl),
      });

      // Broadcast the sweep transaction
      const txHash = await walletClient.sendTransaction({
        to: HOT_WALLET_ADDRESS as `0x${string}`,
        value: sweepAmount,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gas: gasLimit,
      });

      logger.info('✅ Sweep transaction broadcasted', {
        address: wallet.address,
        txHash,
        amount: formatEther(sweepAmount) + ' ETH',
      });

      // Record in our transactions log for auditing
      await prisma.transaction.create({
        data: {
          txHash,
          type: TransactionType.SWEEP,
          status: TransactionStatus.PENDING,
          toAddress: HOT_WALLET_ADDRESS,
          amount: sweepAmount.toString(),
        },
      });

      sweptCount++;

    } catch (error) {
      // Keep going if a single wallet sweep fails (network lag, gas fluctuations, etc.)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to sweep wallet', {
        address: wallet.address,
        error: errorMessage,
      });
    }
  }

  logger.info('Sweeper Worker finished', {
    totalWallets: wallets.length,
    swept: sweptCount,
    skipped: skippedCount,
  });
}

// Auto run when script is called
sweep()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Fatal Sweeper Error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  });