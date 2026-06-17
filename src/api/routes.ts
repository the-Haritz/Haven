import { Router } from 'express';
import { prisma } from '../infrastructure/db';
import { WalletService } from '../usecases/WalletService';

export const routes = Router();
const walletService = new WalletService();

// Health check
routes.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create a new user and auto-generate their deposit wallet
routes.post('/users', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
       res.status(400).json({ error: 'Email is required' });
       return;
    }

    // Wrap in a transaction to ensure we don't end up with an orphaned user without a wallet
    // Note: MVP simplification. In high-concurrency, derivationIndex generation might need 
    // row-locking or a dedicated sequence generator to avoid race conditions.
    const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: { email }
        });
        
        // We call the service, but since we are in a transaction, we'd normally inject `tx`.
        // For this MVP, since WalletService uses the global prisma, there's a slight race 
        // condition risk here if many users are created simultaneously. 
        // We will note this in archdecisions.md later.
        const wallet = await walletService.createWalletForUser(user.id);

        return { user, wallet };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error); // Pass to global error handler
  }
});
