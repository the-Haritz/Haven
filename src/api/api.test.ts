import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { routes } from './routes';
import { errorHandler } from './middleware';
import { prisma } from '../infrastructure/db';

// Create a test express app instance
const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

// Mock hotWalletClient sendTransaction so integration tests do not attempt real blockchain broadcasts
vi.mock('../infrastructure/hotWallet', () => {
  return {
    hotWalletClient: {
      sendTransaction: vi.fn(),
    },
  };
});
import { hotWalletClient } from '../infrastructure/hotWallet';

describe('Haven API Integration Tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('should return 200 and health status', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('POST /api/users', () => {
    it('should create a new user and derive their deposit address', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({ email: 'integration-test@example.com' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('email', 'integration-test@example.com');
      expect(response.body).toHaveProperty('wallet');
      expect(response.body.wallet).toHaveProperty('address');
      expect(response.body.wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(response.body.wallet).toHaveProperty('derivationIndex', 0);

      // Verify records are present in the DB
      const user = await prisma.user.findUnique({
        where: { email: 'integration-test@example.com' },
      });
      expect(user).not.toBeNull();
      const wallet = await prisma.wallet.findFirst({
        where: { userId: user!.id },
      });
      expect(wallet).not.toBeNull();
    });

    it('should reject invalid email formats', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid email format');
    });
  });

  describe('GET /api/users/:id/balance', () => {
    it('should return 404 if user does not exist', async () => {
      const response = await request(app).get('/api/users/non-existent-uuid/balance');
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'User not found');
    });

    it('should return 0 balance for a new user', async () => {
      const user = await prisma.user.create({
        data: { email: 'new-user-bal@example.com' },
      });

      const response = await request(app).get(`/api/users/${user.id}/balance`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        userId: user.id,
        balance: '0',
      });
    });
  });

  describe('POST /api/webhooks/deposits', () => {
    it('should register a deposit and update user balance', async () => {
      // Create user and wallet
      const user = await prisma.user.create({ data: { email: 'webhook-user@example.com' } });
      const testAddress = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
      await prisma.wallet.create({
        data: {
          userId: user.id,
          address: testAddress,
          derivationIndex: 1,
        },
      });

      // Send webhook payload
      const response = await request(app)
        .post('/api/webhooks/deposits')
        .send({
          event: {
            activity: [
              {
                toAddress: testAddress,
                value: '40000000000000000', // 0.04 ETH in wei
                hash: '0xmockdeposit-hash-1',
              },
            ],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'success', depositsRecorded: 1 });

      // Verify balance updated
      const balResponse = await request(app).get(`/api/users/${user.id}/balance`);
      expect(balResponse.body.balance).toBe('40000000000000000');
    });

    it('should maintain idempotency and ignore duplicate deposit webhooks', async () => {
      const user = await prisma.user.create({ data: { email: 'webhook-idemp@example.com' } });
      const testAddress = '0x1234567890123456789012345678901234567890';
      await prisma.wallet.create({
        data: {
          userId: user.id,
          address: testAddress,
          derivationIndex: 2,
        },
      });

      const txHash = '0xdup-hash-webhook';

      // First webhook call
      const res1 = await request(app)
        .post('/api/webhooks/deposits')
        .send({
          event: {
            activity: [
              {
                toAddress: testAddress,
                value: '30000000000000000',
                hash: txHash,
              },
            ],
          },
        });
      expect(res1.body.depositsRecorded).toBe(1);

      // Duplicate webhook call
      const res2 = await request(app)
        .post('/api/webhooks/deposits')
        .send({
          event: {
            activity: [
              {
                toAddress: testAddress,
                value: '30000000000000000',
                hash: txHash,
              },
            ],
          },
        });
      expect(res2.body.depositsRecorded).toBe(0); // Ignored
    });
  });

  describe('POST /api/withdraw', () => {
    it('should fail with ValidationError if params are missing', async () => {
      const response = await request(app)
        .post('/api/withdraw')
        .send({ userId: 'user-id-only' });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('userId, amount, and toAddress are required');
    });

    it('should fail if external address is invalid', async () => {
      const response = await request(app)
        .post('/api/withdraw')
        .send({
          userId: 'some-user',
          amount: '10000',
          toAddress: 'invalid-eth-address',
        });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid Ethereum address');
    });

    it('should successfully execute a valid withdrawal', async () => {
      const user = await prisma.user.create({ data: { email: 'withdraw-api@example.com' } });

      // Deposit funds first
      await prisma.ledger.create({
        data: {
          userId: user.id,
          amount: '80000000000000000', // 0.08 ETH
          type: 'DEPOSIT',
          status: 'COMPLETED',
          txHash: '0xprefunded-api-hash',
        },
      });

      const mockTxHash = '0xapi-withdrawal-txhash';
      vi.mocked(hotWalletClient.sendTransaction).mockResolvedValue(mockTxHash);

      const response = await request(app)
        .post('/api/withdraw')
        .send({
          userId: user.id,
          amount: '50000000000000000', // 0.05 ETH
          toAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        });

      expect(response.status).toBe(202); // 202 Accepted
      expect(response.body).toHaveProperty('status', 'PENDING');
      expect(response.body).toHaveProperty('txHash', mockTxHash);

      // Verify balance reduced
      const balResponse = await request(app).get(`/api/users/${user.id}/balance`);
      expect(balResponse.body.balance).toBe('30000000000000000'); // 0.03 ETH left
    });
  });
});
