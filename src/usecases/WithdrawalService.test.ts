import { vi, describe, it, expect, beforeEach } from 'vitest';
import { WithdrawalService } from './WithdrawalService';
import { prisma } from '../infrastructure/db';
import { LedgerType, LedgerStatus, TransactionType, TransactionStatus } from '../domain/types';

// Mock the hotWalletClient to prevent real RPC calls during tests
vi.mock('../infrastructure/hotWallet', () => {
  return {
    hotWalletClient: {
      sendTransaction: vi.fn(),
    },
  };
});

// Import the mocked module for configuration in tests
import { hotWalletClient } from '../infrastructure/hotWallet';

describe('WithdrawalService', () => {
  const withdrawalService = new WithdrawalService();
  const testUserId = 'test-withdraw-user';
  const toAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create the test user in the clean database
    await prisma.user.create({
      data: {
        id: testUserId,
        email: 'withdraw-test@example.com',
      },
    });

    // Fund the user with 0.1 ETH (100000000000000000 wei)
    await prisma.ledger.create({
      data: {
        userId: testUserId,
        amount: '100000000000000000',
        type: LedgerType.DEPOSIT,
        status: LedgerStatus.COMPLETED,
        txHash: '0xinitial-deposit-hash',
      },
    });
  });

  it('should successfully orchestrate a withdrawal (happy path)', async () => {
    const mockTxHash = '0xmocked-withdrawal-txhash';
    vi.mocked(hotWalletClient.sendTransaction).mockResolvedValue(mockTxHash);

    const amount = 30000000000000000n; // 0.03 ETH
    const result = await withdrawalService.processWithdrawal(testUserId, amount, toAddress);

    // 1. Verify return values
    expect(result.txHash).toBe(mockTxHash);
    expect(result.explorerUrl).toContain(mockTxHash);

    // 2. Verify blockchain call details
    expect(hotWalletClient.sendTransaction).toHaveBeenCalledWith({
      to: toAddress,
      value: amount,
    });

    // 3. Verify ledger entry state is COMPLETED
    const ledgerEntry = await prisma.ledger.findFirst({
      where: { userId: testUserId, type: LedgerType.WITHDRAWAL },
    });
    expect(ledgerEntry).not.toBeNull();
    expect(ledgerEntry!.status).toBe(LedgerStatus.COMPLETED);
    expect(ledgerEntry!.txHash).toBe(mockTxHash);

    // 4. Verify transaction table entry
    const transactionRecord = await prisma.transaction.findUnique({
      where: { txHash: mockTxHash },
    });
    expect(transactionRecord).not.toBeNull();
    expect(transactionRecord!.type).toBe(TransactionType.WITHDRAWAL);
    expect(transactionRecord!.status).toBe(TransactionStatus.PENDING);
    expect(transactionRecord!.amount).toBe(amount.toString());
  });

  it('should fail and unlock funds if blockchain broadcast fails', async () => {
    vi.mocked(hotWalletClient.sendTransaction).mockRejectedValue(new Error('RPC network connection timeout'));

    const amount = 20000000000000000n; // 0.02 ETH

    // Should throw BlockchainError
    await expect(
      withdrawalService.processWithdrawal(testUserId, amount, toAddress)
    ).rejects.toThrow(/Failed to broadcast withdrawal transaction to the network/);

    // Verify ledger entry is marked FAILED (unlocking funds)
    const ledgerEntry = await prisma.ledger.findFirst({
      where: { userId: testUserId, type: LedgerType.WITHDRAWAL },
    });
    expect(ledgerEntry).not.toBeNull();
    expect(ledgerEntry!.status).toBe(LedgerStatus.FAILED);

    // Verify balance is restored/unaffected by the attempt
    const ledgerEntries = await prisma.ledger.findMany({ where: { userId: testUserId } });
    let balance = 0n;
    for (const entry of ledgerEntries) {
      if (entry.type === LedgerType.DEPOSIT) {
        balance += BigInt(entry.amount);
      } else if (entry.type === LedgerType.WITHDRAWAL && entry.status !== LedgerStatus.FAILED) {
        balance -= BigInt(entry.amount);
      }
    }
    expect(balance).toBe(100000000000000000n); // Stays at initial 0.1 ETH

    // Verify no Transaction record was created in the database
    const transactionCount = await prisma.transaction.count();
    expect(transactionCount).toBe(0);
  });
});
