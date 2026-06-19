import { vi, describe, it, expect, beforeEach } from 'vitest';
import { WithdrawalService } from './WithdrawalService';
import { LedgerService } from './LedgerService';
import { prisma } from '../infrastructure/db';
import { LedgerType, LedgerStatus, TransactionType } from '../domain/types';

// Mock hotWalletClient
vi.mock('../infrastructure/hotWallet', () => {
  return {
    hotWalletClient: {
      sendTransaction: vi.fn(),
    },
  };
});
import { hotWalletClient } from '../infrastructure/hotWallet';

describe('Concurrency & Balance Invariant Tests', () => {
  const withdrawalService = new WithdrawalService();
  const ledgerService = new LedgerService();
  const testUserId = 'concurrent-user-999';
  const toAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create user
    await prisma.user.create({
      data: {
        id: testUserId,
        email: 'concurrent@example.com',
      },
    });

    // Fund the user with 50 Token Units (e.g., 50 * 10^15 wei)
    await prisma.ledger.create({
      data: {
        userId: testUserId,
        amount: '50000000000000000',
        type: LedgerType.DEPOSIT,
        status: LedgerStatus.COMPLETED,
        txHash: '0xconcur-deposit',
      },
    });
  });

  it('should serialize concurrent withdrawals and prevent double-spend attempts', async () => {
    // Mock sendTransaction to introduce a slight delay (50ms) to simulate active execution
    let txCounter = 0;
    vi.mocked(hotWalletClient.sendTransaction).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      txCounter++;
      return `0xmock-tx-${txCounter}`;
    });

    const withdrawalAmount = 50000000000000000n; // Entire balance (50 Token Units)

    // Trigger 5 concurrent withdrawal requests of the ENTIRE balance simultaneously
    const requests = Array.from({ length: 5 }).map(() =>
      withdrawalService.processWithdrawal(testUserId, withdrawalAmount, toAddress)
    );

    const results = await Promise.allSettled(requests);

    // Filter results
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // 1. Invariant: Exactly 1 withdrawal must succeed, and 4 must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    // 2. Invariant: Rejected promises must have thrown InsufficientFundsError (400)
    for (const rej of rejected) {
      const error = (rej as PromiseRejectedResult).reason;
      expect(error.message).toMatch(/Insufficient balance for this withdrawal/);
    }

    // 3. Invariant: User balance must never be negative (should be exactly 0 after 1 successful withdrawal)
    const finalBalance = await ledgerService.getAvailableBalance(testUserId);
    expect(finalBalance).toBe(0n);

    // 4. Invariant: Only 1 transaction entry should be generated in the Transactions table
    const dbTransactions = await prisma.transaction.findMany();
    expect(dbTransactions.length).toBe(1);
    expect(dbTransactions[0]!.amount).toBe(withdrawalAmount.toString());
  });
});
