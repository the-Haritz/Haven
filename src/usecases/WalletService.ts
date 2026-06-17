import { mnemonicToAccount } from 'viem/accounts';
import { prisma } from '../infrastructure/db';

export class WalletService {
  private masterMnemonic: string;

  constructor() {
    // In production, this should throw if missing. For MVP dev, we can provide a fallback.
    this.masterMnemonic = process.env.MASTER_MNEMONIC || 'test test test test test test test test test test test junk';
    
    // We enforce english language for mnemonic parsing as standard
    if (this.masterMnemonic.split(' ').length < 12) {
      throw new Error("Invalid MASTER_MNEMONIC. Must be at least 12 words.");
    }
  }

  /**
   * Derives a new deposit address for a user and saves it to the database.
   */
  async createWalletForUser(userId: string) {
    // 1. Find the highest derivation index currently in the database to know what's next
    const lastWallet = await prisma.wallet.findFirst({
      orderBy: { derivationIndex: 'desc' },
    });

    const nextIndex = lastWallet ? lastWallet.derivationIndex + 1 : 0;

    // 2. Derive the account in memory using Viem
    // By default, mnemonicToAccount uses the standard Ethereum path: m/44'/60'/0'/0/${addressIndex}
    const account = mnemonicToAccount(this.masterMnemonic, { addressIndex: nextIndex });

    // 3. Save the public info to the database
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

  /**
   * Retrieves the temporary signer (private key) for a specific user's wallet.
   * THIS IS DANGEROUS. ONLY USE IN THE SWEEPER/WITHDRAWAL WORKER.
   */
  async getSignerForWallet(derivationIndex: number) {
    return mnemonicToAccount(this.masterMnemonic, { addressIndex: derivationIndex });
  }
}
