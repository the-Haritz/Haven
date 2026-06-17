import { mnemonicToAccount } from 'viem/accounts';
import { prisma } from '../infrastructure/db';

export class WalletService {
  private masterMnemonic: string;

  constructor() {
    // Throws in production if missing. Fallback for local dev.
    this.masterMnemonic = process.env.MASTER_MNEMONIC || 'test test test test test test test test test test test junk';
    
    if (this.masterMnemonic.split(' ').length < 12) {
      throw new Error("Invalid MASTER_MNEMONIC. Must be at least 12 words.");
    }
  }

  async createWalletForUser(userId: string) {
    const lastWallet = await prisma.wallet.findFirst({
      orderBy: { derivationIndex: 'desc' },
    });

    const nextIndex = lastWallet ? lastWallet.derivationIndex + 1 : 0;

    const account = mnemonicToAccount(this.masterMnemonic, { addressIndex: nextIndex });

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        address: account.address,
        derivationIndex: nextIndex,
      },
    });

    return {
        id: wallet.id,
        address: wallet.address,
        derivationIndex: wallet.derivationIndex
    };
  }

  async getSignerForWallet(derivationIndex: number) {
    return mnemonicToAccount(this.masterMnemonic, { addressIndex: derivationIndex });
  }
}
