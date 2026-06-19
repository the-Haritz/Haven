import { describe, it, expect, vi } from 'vitest';

describe('Config Loader', () => {
  it('should load the default values in test environment', async () => {
    const { config } = await import('./config.js');
    expect(config.nodeEnv).toBe('test');
    expect(config.databaseUrl).toBe('file:./test.db');
  });

  it('should throw error in production if a required variable is missing', async () => {
    const originalEnv = { ...process.env };

    // Set production env
    process.env.NODE_ENV = 'production';
    
    // Provide secure custom values for other keys so they pass validation
    process.env.DATABASE_URL = 'file:./prod.db';
    process.env.RPC_URL = 'https://custom-production-rpc-endpoint.com';
    process.env.HOT_WALLET_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
    process.env.HOT_WALLET_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    
    // Delete the one we are testing
    delete process.env.MASTER_MNEMONIC;

    vi.resetModules();

    await expect(async () => {
      await import('./config.js');
    }).rejects.toThrow(/MASTER_MNEMONIC/);

    // Restore original environment
    process.env = originalEnv;
    vi.resetModules();
  });

  it('should throw error in production if using insecure default values', async () => {
    const originalEnv = { ...process.env };

    process.env.NODE_ENV = 'production';
    
    // Provide secure custom values for other keys
    process.env.DATABASE_URL = 'file:./prod.db';
    process.env.RPC_URL = 'https://custom-production-rpc-endpoint.com';
    process.env.HOT_WALLET_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
    process.env.HOT_WALLET_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    
    // Set the insecure default mnemonic
    process.env.MASTER_MNEMONIC = 'test test test test test test test test test test test junk';

    vi.resetModules();

    await expect(async () => {
      await import('./config.js');
    }).rejects.toThrow(/is using an insecure default value/);

    // Restore original environment
    process.env = originalEnv;
    vi.resetModules();
  });
});
