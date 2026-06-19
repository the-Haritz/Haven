// Set environment variables synchronously before any application imports
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.MASTER_MNEMONIC = 'test test test test test test test test test test test junk';
process.env.HOT_WALLET_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.HOT_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
process.env.RPC_URL = 'https://sepolia.base.org';
process.env.LOG_LEVEL = 'error'; // Keep test logs clean
