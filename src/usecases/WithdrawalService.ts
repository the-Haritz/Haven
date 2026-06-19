// WithdrawalService coordinates the payout flow:
// 1. Locks the requested amount in the user's available balance immediately.
// 2. Grabs the hot wallet mutex to prevent duplicate transaction nonces.
// 3. Signs and broadcasts the payout transaction via the hot wallet.
// 4. Updates ledger to COMPLETED and saves details on success.
// 5. Reverts ledger to FAILED (unlocking funds) on failure.

import { prisma } from '../infrastructure/db';
import { hotWalletClient } from '../infrastructure/hotWallet';
import { Mutex } from '../infrastructure/mutex';
import { logger } from '../infrastructure/logger';
import { config } from '../infrastructure/config';
import { LedgerService } from './LedgerService';
import { TransactionType, TransactionStatus } from '../domain/types';
import { BlockchainError } from '../domain/errors';

// Shared lock to protect hot wallet nonce increment logic
const withdrawalMutex = new Mutex();

export class WithdrawalService {
  private ledgerService: LedgerService;

  constructor() {
    this.ledgerService = new LedgerService();
  }

  // Orchestrates a complete user withdrawal.
  async processWithdrawal(
    userId: string,
    amount: bigint,
    toAddress: `0x${string}`
  ): Promise<{ txHash: string; explorerUrl: string }> {

    // 1. Lock funds inside LedgerService (throws if balance is too low)
    const ledgerId = await this.ledgerService.createPendingWithdrawal(userId, amount);

    // 2. Grab the nonce mutex lock and broadcast
    const unlock = await withdrawalMutex.lock();
    let txHash: string;

    try {
      logger.info('Broadcasting withdrawal transaction', {
        userId,
        toAddress,
        amount: amount.toString(),
      });

      txHash = await hotWalletClient.sendTransaction({
        to: toAddress,
        value: amount,
        // Gas estimates and network limits are handled automatically by Viem
      });
    } catch (error) {
      // Free the mutex first, then process the failure
      unlock();

      // Revert the ledger entry so the user gets their balance back
      await this.ledgerService.failWithdrawal(ledgerId);

      const errorMessage = error instanceof Error ? error.message : 'Unknown broadcast error';
      logger.error('Withdrawal broadcast failed', {
        userId,
        ledgerId,
        toAddress,
        error: errorMessage,
      });

      throw new BlockchainError('Failed to broadcast withdrawal transaction to the network');
    }

    // Free the mutex on success
    unlock();

    // 3. Record on-chain transaction logs and complete the ledger entry
    await this.ledgerService.completeWithdrawal(ledgerId, txHash);

    await prisma.transaction.create({
      data: {
        txHash,
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING, // Still waiting to get mined in the mempool
        toAddress,
        amount: amount.toString(),
      },
    });

    const explorerUrl = `${config.explorerBaseUrl}/tx/${txHash}`;

    logger.info('Withdrawal broadcasted successfully', {
      userId,
      txHash,
      explorerUrl,
    });

    return { txHash, explorerUrl };
  }
}
