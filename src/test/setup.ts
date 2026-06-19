import './env'; // Sets environment variables synchronously before anything else runs

import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../infrastructure/db';
import { execSync } from 'child_process';

// Sync the schema to the test database once when setup is run
try {
  execSync('npx prisma db push --accept-data-loss', {
    env: process.env,
    stdio: 'pipe',
  });
} catch (error: any) {
  console.error('❌ Failed to push schema to test database:', error.message);
  if (error.stdout) console.error('Prisma stdout:', error.stdout.toString());
  if (error.stderr) console.error('Prisma stderr:', error.stderr.toString());
}

beforeEach(async () => {
  // Clear all database tables to ensure test isolation
  const tablenames = ['Ledger', 'Transaction', 'Wallet', 'User'];
  for (const name of tablenames) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${name}";`);
    } catch (e) {
      // Ignore if table doesn't exist yet
    }
  }
});

afterAll(async () => {
  // Disconnect prisma client to release database locks
  await prisma.$disconnect();
});
