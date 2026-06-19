// LedgerService tracks internal accounting.
// This is the core ledger logic. We use an append-only ledger pattern:
// instead of modifying history, we write new entries to represent deposits/withdrawals.
//
// Key logic:
// To calculate available balance, we subtract both completed AND pending withdrawals.
// This locks the funds immediately when a withdrawal starts, stopping double-spends.

import { prisma } from '../infrastructure/db';
import { logger } from '../infrastructure/logger';
import { LedgerType, LedgerStatus } from '../domain/types';
import { InsufficientFundsError } from '../domain/errors';
import type { Prisma } from '@prisma/client';
import { KeyedMutex } from '../infrastructure/mutex';

// Serialize balance checks and pending entry creation per-user to prevent race conditions
const ledgerMutex = new KeyedMutex();

export class LedgerService {

  // Sums up all ledger entries.
  // - Deposits: only count completed/confirmed ones.
  // - Withdrawals: deduct both completed and pending ones.
  // - Failed withdrawals: ignore them (their funds are unlocked).
  async getAvailableBalance(userId: string): Promise<bigint> {
    const ledgerEntries = await prisma.ledger.findMany({
      where: { userId },
    });

    let balance = 0n;

    for (const entry of ledgerEntries) {
      const amount = BigInt(entry.amount);

      if (entry.type === LedgerType.DEPOSIT && entry.status === LedgerStatus.COMPLETED) {
        balance += amount;
      } else if (entry.type === LedgerType.WITHDRAWAL) {
        if (entry.status === LedgerStatus.COMPLETED || entry.status === LedgerStatus.PENDING) {
          balance -= amount;
        }
      }
    }

    return balance;
  }

  // Webhook deposit registration.
  // We check the txHash first to prevent duplicate recording (at-least-once webhook safety).
  async recordDeposit(
    userId: string,
    amount: string,
    txHash: string
  ): Promise<boolean> {
    // Already processed this tx
    const existingEntry = await prisma.ledger.findFirst({
      where: { txHash },
    });

    if (existingEntry) {
      logger.warn('Duplicate deposit webhook received, skipping', { txHash, userId });
      return false;
    }

    await prisma.ledger.create({
      data: {
        userId,
        amount,
        type: LedgerType.DEPOSIT,
        status: LedgerStatus.COMPLETED,
        txHash,
      },
    });

    logger.info('Deposit recorded in ledger', { userId, amount, txHash });
    return true;
  }

  // Starts a withdrawal, locking the funds by creating a PENDING ledger entry.
  // Runs under a per-user mutex to prevent concurrent balance-check race conditions.
  async createPendingWithdrawal(
    userId: string,
    amount: bigint
  ): Promise<string> {
    const unlock = await ledgerMutex.lock(userId);
    try {
      const balance = await this.getAvailableBalance(userId);

      if (balance < amount) {
        logger.warn('Withdrawal rejected: insufficient funds', {
          userId,
          requested: amount.toString(),
          available: balance.toString(),
        });
        throw new InsufficientFundsError();
      }

      const record = await prisma.ledger.create({
        data: {
          userId,
          amount: amount.toString(),
          type: LedgerType.WITHDRAWAL,
          status: LedgerStatus.PENDING,
        },
      });

      logger.info('Pending withdrawal created (funds locked)', {
        userId,
        amount: amount.toString(),
        ledgerId: record.id,
      });

      return record.id;
    } finally {
      unlock();
    }
  }

  // Finalizes a withdrawal with its txHash.
  async completeWithdrawal(ledgerId: string, txHash: string): Promise<void> {
    await prisma.ledger.update({
      where: { id: ledgerId },
      data: {
        status: LedgerStatus.COMPLETED,
        txHash,
      },
    });

    logger.info('Withdrawal completed', { ledgerId, txHash });
  }

  // Unlocks user funds by marking the pending entry as FAILED.
  async failWithdrawal(ledgerId: string): Promise<void> {
    await prisma.ledger.update({
      where: { id: ledgerId },
      data: { status: LedgerStatus.FAILED },
    });

    logger.warn('Withdrawal marked as FAILED (funds unlocked)', { ledgerId });
  }
}
