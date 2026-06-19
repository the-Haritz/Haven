// Prisma client initialization.
// We use a singleton pattern here to prevent connection exhaustion when
// ts-node-dev restarts the server locally.
// Note: Prisma 7 removed the native Rust query engine, so we use the SQLite driver adapter.

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { config } from './config';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const adapter = new PrismaBetterSqlite3({
  url: config.databaseUrl,
});

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

if (!config.isProduction) globalForPrisma.prisma = prisma;
