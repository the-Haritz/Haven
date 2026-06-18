import { Router } from 'express';
import { prisma } from '../infrastructure/db';
import { WalletService } from '../usecases/WalletService';

export const routes = Router();
const walletService = new WalletService();

routes.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

routes.post('/users', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
       res.status(400).json({ error: 'Email is required' });
       return;
    }

    // Wrap in a transaction so I don't end up with an orphaned user without a wallet.
    // MVP simplification: In high-concurrency, derivationIndex generation might need 
    // row-locking or a dedicated sequence generator to avoid race conditions.
    const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: { email }
        });
        
        // Pass the transaction client so this operation is part of the atomic commit
        const wallet = await walletService.createWalletForUser(user.id, tx);

        return { user, wallet };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

routes.get('/users/:id/balance', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Fetch all completed ledger entries to calculate available balance.
    // We do the math using BigInt because values are stored as Strings 
    // to preserve precision of ERC20/ETH (up to 18 decimals) beyond JS Number limits.
    const ledgerEntries = await prisma.ledger.findMany({
      where: { 
        userId: id,
        status: 'COMPLETED' 
      },
    });

    let balance = 0n;

    for (const entry of ledgerEntries) {
      const amount = BigInt(entry.amount);
      if (entry.type === 'DEPOSIT') {
        balance += amount;
      } else if (entry.type === 'WITHDRAWAL') {
        balance -= amount;
      }
    }

    res.json({
      userId: id,
      balance: balance.toString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Webhook endpoint to receive deposit notifications from an external provider (e.g., Alchemy Notify).
 * This replaces the need for a custom indexing worker.
 */
routes.post('/webhooks/deposits', async (req, res, next) => {
  try {
    // In a production environment, you MUST verify the webhook signature here
    // to ensure the request actually came from Alchemy/QuickNode.
    // e.g., verifySignature(req.headers['x-alchemy-signature'], req.body, process.env.WEBHOOK_SECRET);

    const { event } = req.body;

    // Assuming a standard Activity Webhook payload format
    if (!event || !event.activity || event.activity.length === 0) {
      res.status(200).send('No activity found'); // Return 200 so the provider doesn't retry
      return;
    }

    for (const activity of event.activity) {
      const { toAddress, value, hash } = activity;

      if (!toAddress || !value || !hash) continue;

      // 1. Check if we care about this address (is it one of ours?)
      const wallet = await prisma.wallet.findUnique({
        where: { address: toAddress.toLowerCase() },
      });

      if (!wallet) {
        console.log(`Ignoring deposit to unknown address: ${toAddress}`);
        continue;
      }

      // 2. Idempotency Check: Providers guarantee at-least-once delivery.
      // We must ensure we don't process the same transaction hash twice.
      const existingTx = await prisma.ledger.findFirst({
        where: { txHash: hash },
      });

      if (existingTx) {
        console.log(`Transaction ${hash} already processed. Skipping.`);
        continue;
      }

      // 3. Record the deposit in the internal ledger
      // Convert standard value to string for DB storage (assuming provider sends raw wei/gwei string)
      await prisma.ledger.create({
        data: {
          userId: wallet.userId,
          amount: value.toString(),
          type: 'DEPOSIT',
          status: 'COMPLETED',
          txHash: hash,
        },
      });

      console.log(`Processed deposit of ${value} for user ${wallet.userId} (tx: ${hash})`);
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Return 500 so the infrastructure provider knows to retry the webhook later
    res.status(500).json({ error: 'Internal server error' });
  }
});
