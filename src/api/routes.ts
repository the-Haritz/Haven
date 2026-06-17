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
        
        // Calling the service here. Since it uses the global prisma instance, 
        // there's a slight race condition risk here if many users are created simultaneously. 
        // I noted this in archdecisions.md.
        const wallet = await walletService.createWalletForUser(user.id);

        return { user, wallet };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
