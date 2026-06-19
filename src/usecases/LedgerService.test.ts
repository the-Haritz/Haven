import { describe, it, expect, beforeEach } from 'vitest';
import { LedgerService } from './LedgerService';
import { prisma } from '../infrastructure/db';
import { LedgerType, LedgerStatus } from '../domain/types';

describe('LedgerService', () => {
  const ledgerService = new LedgerService();
  const testUserId = 'test-user-123';

  beforeEach(async () => {
    // Create the test users to avoid foreign key violations in append-only ledger entries
    await prisma.user.create({
      data: {
        id: testUserId,
        email: 'test-user@example.com',
      },
    });

    await prisma.user.create({
      data: {
        id: 'poor-user-456',
        email: 'poor-user@example.com',
      },
    });
  });

  it('should start with a zero balance', async () => {
    const balance = await ledgerService.getAvailableBalance(testUserId);
    expect(balance).toBe(0n);
  });

  it('should correctly calculate balance with deposits and withdrawals', async () => {
    // 1. Add a completed deposit of 0.1 ETH (10^17 wei)
    await prisma.ledger.create({
      data: {
        userId: testUserId,
        amount: '100000000000000000',
        type: LedgerType.DEPOSIT,
        status: LedgerStatus.COMPLETED,
        txHash: '0x123',
      },
    });

    let balance = await ledgerService.getAvailableBalance(testUserId);
    expect(balance).toBe(100000000000000000n);

    // 2. Add a pending withdrawal of 0.03 ETH
    const w1Id = await ledgerService.createPendingWithdrawal(testUserId, 30000000000000000n);
    balance = await ledgerService.getAvailableBalance(testUserId);
    // Balance should be reduced by pending withdrawal (now 0.07 ETH)
    expect(balance).toBe(70000000000000000n);

    // 3. Complete the pending withdrawal
    await ledgerService.completeWithdrawal(w1Id, '0x456');
    balance = await ledgerService.getAvailableBalance(testUserId);
    // Balance stays 0.07 ETH since it was already deducted as pending
    expect(balance).toBe(70000000000000000n);

    // 4. Create another pending withdrawal of 0.02 ETH
    const w2Id = await ledgerService.createPendingWithdrawal(testUserId, 20000000000000000n);
    balance = await ledgerService.getAvailableBalance(testUserId);
    // Balance is now 0.05 ETH
    expect(balance).toBe(50000000000000000n);

    // 5. Fail the second withdrawal (e.g. broadcast error)
    await ledgerService.failWithdrawal(w2Id);
    balance = await ledgerService.getAvailableBalance(testUserId);
    // Balance should be restored to 0.07 ETH (funds unlocked)
    expect(balance).toBe(70000000000000000n);
  });

  it('should enforce idempotency on deposit registration', async () => {
    const txHash = '0xdep-idemp';
    const amount = '50000000000000000';

    // First deposit recording
    const recorded1 = await ledgerService.recordDeposit(testUserId, amount, txHash);
    expect(recorded1).toBe(true);

    // Second duplicate recording
    const recorded2 = await ledgerService.recordDeposit(testUserId, amount, txHash);
    expect(recorded2).toBe(false);

    // Check that only 1 deposit entry exists in the DB
    const count = await prisma.ledger.count({
      where: { txHash, type: LedgerType.DEPOSIT },
    });
    expect(count).toBe(1);
  });

  it('should throw InsufficientFundsError when balance is too low', async () => {
    const userId = 'poor-user-456';
    const balance = await ledgerService.getAvailableBalance(userId);
    expect(balance).toBe(0n);

    await expect(
      ledgerService.createPendingWithdrawal(userId, 1000n)
    ).rejects.toThrow(/Insufficient balance for this withdrawal/);
  });
});
