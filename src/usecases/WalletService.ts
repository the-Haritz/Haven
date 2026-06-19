// WalletService derives user deposit addresses on the fly using BIP-39/BIP-44 HD Wallets.
// We load a single master mnemonic from the config and derive unique accounts.
//
// Security:
// We never store private keys in the database. Instead, we only store the public address
// and its derivation index. If the database leaks, keys are safe. We temporarily derive
// private keys in memory only when we need to sweep funds.

import { mnemonicToAccount } from 'viem/accounts';
import type { Prisma } from '@prisma/client';
import { prisma } from '../infrastructure/db';
import { config } from '../infrastructure/config';
import { logger } from '../infrastructure/logger';

export class WalletService {
  private masterMnemonic: string;

  constructor() {
    this.masterMnemonic = config.masterMnemonic;

    // Mnemonic must have at least 12 words to be valid BIP-39
    const wordCount = this.masterMnemonic.split(' ').length;
    if (wordCount < 12) {
      throw new Error(
        `Invalid MASTER_MNEMONIC: expected at least 12 words, got ${wordCount}.`
      );
    }
  }

  // Generates a new deposit address and records it.
  // Supports an optional transaction client to make user registration atomic.
  async createWalletForUser(userId: string, tx?: Prisma.TransactionClient) {
    const db = tx || prisma;

    // Find the next derivation index.
    // Note: In a high-concurrency app, you'd use a DB sequence or lock to avoid index conflicts.
    const lastWallet = await db.wallet.findFirst({
      orderBy: { derivationIndex: 'desc' },
    });

    const nextIndex = lastWallet ? lastWallet.derivationIndex + 1 : 0;

    // Standard derivation path: m/44'/60'/0'/0/{index}
    const account = mnemonicToAccount(this.masterMnemonic, {
      addressIndex: nextIndex,
    });

    // Normalize address to lowercase to avoid case-matching headaches later
    const wallet = await db.wallet.create({
      data: {
        userId,
        address: account.address.toLowerCase(),
        derivationIndex: nextIndex,
      },
    });

    logger.info('Wallet created for user', {
      userId,
      address: wallet.address,
      derivationIndex: nextIndex,
    });

    return {
      id: wallet.id,
      address: wallet.address,
      derivationIndex: wallet.derivationIndex,
    };
  }

  // Helper to get the actual signer for a wallet by its index.
  // Used by the sweeper to sign transactions. Keeps the private key in memory temporarily.
  getSignerForWallet(derivationIndex: number) {
    return mnemonicToAccount(this.masterMnemonic, {
      addressIndex: derivationIndex,
    });
  }
}
