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
