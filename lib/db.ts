import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }

  // Configure connection pool for serverless environment
  // This helps prevent "max clients reached" errors
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  })

  // In production, also cache the client to reuse connections
  globalForPrisma.prisma = client

  return client
}

export const prisma: PrismaClient = getPrismaClient()
