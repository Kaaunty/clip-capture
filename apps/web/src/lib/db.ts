import { PrismaClient } from '@prisma/client';
import path from 'path';

// If DATABASE_URL is unset or uses the default relative path, resolve to absolute path
// so runtime queries resolve to the same database file regardless of process working directory.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL === 'file:./dev.db') {
  const dbPath = path.resolve(__dirname, '../../prisma/dev.db');
  process.env.DATABASE_URL = `file:${dbPath}`;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : process.env.NODE_ENV === 'test'
          ? []
          : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
