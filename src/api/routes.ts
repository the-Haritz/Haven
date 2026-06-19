// API Routes — Thin Controller Layer
// We keep this file focused on HTTP-level details:
// 1. Parsing and validating the request body
// 2. Delegating to use case services (which own the actual business logic)
// 3. Formatting and returning HTTP responses
//
// Keep database queries, math, and blockchain calls out of here.

import { Router } from 'express';
import { prisma } from '../infrastructure/db';
import { logger } from '../infrastructure/logger';
import { WalletService } from '../usecases/WalletService';
import { LedgerService } from '../usecases/LedgerService';
import { WithdrawalService } from '../usecases/WithdrawalService';
import { ValidationError, NotFoundError } from '../domain/errors';
import { isValidAddress } from './middleware';

export const routes = Router();

const walletService = new WalletService();
const ledgerService = new LedgerService();
const withdrawalService = new WithdrawalService();

// ─── Health Check ────────────────────────────────────────────────────

routes.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── User Registration ──────────────────────────────────────────────

// Registers a new user.
// Creates the user record and their deposit wallet in a single database transaction.
routes.post('/users', async (req, res, next) => {
  try {
    const { email } = req.body;

    // Basic formatting checks
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }

    // Create both user and wallet atomically so we don't end up with orphaned users
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email },
      });

      // Pass 'tx' to make sure both database writes share the same transaction block
      const wallet = await walletService.createWalletForUser(user.id, tx);

      return { user, wallet };
    });

    logger.info('User created with wallet', {
      userId: result.user.id,
      email: result.user.email,
      walletAddress: result.wallet.address,
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// ─── Balance Query ───────────────────────────────────────────────────

// Gets the user's available balance in Wei (as a string)
routes.get('/users/:id/balance', async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundError('User');
    }

    const balance = await ledgerService.getAvailableBalance(id);

    res.json({
      userId: id,
      balance: balance.toString(),
    });
  } catch (error) {
    next(error);
  }
});

// ─── Deposit Webhook ─────────────────────────────────────────────────

// Receives deposit alerts from our webhook provider (e.g. Alchemy Notify).
// Note: In production, verify the webhook signature (X-Alchemy-Signature) to prevent spoofing.
routes.post('/webhooks/deposits', async (req, res, next) => {
  try {
    const { event } = req.body;

    if (!event || !event.activity || !Array.isArray(event.activity) || event.activity.length === 0) {
      res.status(200).json({ status: 'no_activity' });
      return;
    }

    let processedCount = 0;

    // Alchemy webhooks send an activity array of transaction details
    for (const activity of event.activity) {
      const { toAddress, value, hash } = activity;

      if (!toAddress || !value || !hash) {
        logger.warn('Skipping malformed webhook activity entry', { activity });
        continue;
      }

      // Alchemy sends checksummed or mixed case addresses, DB uses lowercase
      const wallet = await prisma.wallet.findUnique({
        where: { address: toAddress.toLowerCase() },
      });

      if (!wallet) {
        logger.debug('Ignoring deposit to unknown address', { toAddress });
        continue;
      }

      const wasRecorded = await ledgerService.recordDeposit(
        wallet.userId,
        value.toString(),
        hash
      );

      if (wasRecorded) processedCount++;
    }

    logger.info('Webhook processed', {
      totalActivities: event.activity.length,
      depositsRecorded: processedCount,
    });

    // Webhook providers retry on failures (5xx/4xx), so return 200 to acknowledge success
    res.status(200).json({ status: 'success', depositsRecorded: processedCount });
  } catch (error) {
    logger.error('Webhook processing error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // Return 500 so the provider knows we had a glitch and retries the webhook later
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Withdrawal ──────────────────────────────────────────────────────

// Triggers a payout to an external address.
// Deducts balance internally first, then broadcasts to the blockchain.
routes.post('/withdraw', async (req, res, next) => {
  try {
    const { userId, amount, toAddress } = req.body;

    // Fast fail on missing fields
    if (!userId || !amount || !toAddress) {
      throw new ValidationError('userId, amount, and toAddress are required');
    }

    // Fast fail on bad address format
    if (!isValidAddress(toAddress)) {
      throw new ValidationError(
        'Invalid Ethereum address. Must be a 0x-prefixed, 42-character hex string.'
      );
    }

    // Parse Wei to BigInt safely
    let withdrawAmount: bigint;
    try {
      withdrawAmount = BigInt(amount);
    } catch {
      throw new ValidationError('Amount must be a valid integer string (in wei)');
    }

    if (withdrawAmount <= 0n) {
      throw new ValidationError('Amount must be greater than 0');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('User');
    }

    const result = await withdrawalService.processWithdrawal(
      userId,
      withdrawAmount,
      toAddress as `0x${string}`
    );

    // 202 Accepted: transaction is in the mempool but not mined yet.
    // Gives the client a block explorer URL to track confirmation.
    res.status(202).json({
      status: 'PENDING',
      message: 'Withdrawal broadcasted to network',
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
    });
  } catch (error) {
    next(error);
  }
});

// ─── Transaction History ─────────────────────────────────────────────

// Returns the user's transaction ledger history
routes.get('/users/:id/transactions', async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundError('User');
    }

    const ledgerEntries = await prisma.ledger.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      userId: id,
      transactions: ledgerEntries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        status: entry.status,
        amount: entry.amount,
        txHash: entry.txHash,
        createdAt: entry.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});
