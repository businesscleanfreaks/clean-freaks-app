/**
 * Database Safety Utilities
 * 
 * ⚠️ CRITICAL: This module prevents accidental data loss
 * Never bypass these safety checks!
 */

/**
 * List of dangerous Prisma commands that could cause data loss
 */
const DANGEROUS_COMMANDS = [
  '--force-reset',
  'migrate reset',
  'db push --force-reset',
  'db push --skip-generate --force-reset',
  'deploy --force',
  'reset',
]

/**
 * Check if a Prisma command string is safe to execute
 * @param command - The command string to check
 * @returns true if safe, false if dangerous
 */
export function isSafePrismaCommand(command: string): boolean {
  const normalizedCommand = command.toLowerCase().trim()
  
  return !DANGEROUS_COMMANDS.some(dangerous => 
    normalizedCommand.includes(dangerous.toLowerCase())
  )
}

/**
 * Validate a Prisma command and throw an error if dangerous
 * @param command - The command string to validate
 * @throws Error if command is dangerous
 */
export function validatePrismaCommand(command: string): void {
  if (!isSafePrismaCommand(command)) {
    const dangerous = DANGEROUS_COMMANDS.find(d => 
      command.toLowerCase().includes(d.toLowerCase())
    )
    
    throw new Error(
      `❌ BLOCKED: Dangerous Prisma command detected: "${dangerous}"\n` +
      `This command would DELETE ALL DATA from your database.\n` +
      `If you need to reset the database, use a backup restore instead.\n` +
      `To make schema changes safely, use: ./scripts/safe-migrate.sh`
    )
  }
}

/**
 * Check if we're in a safe environment for database operations
 * @returns true if safe, false if production/safe mode
 */
export function isSafeEnvironment(): boolean {
  const nodeEnv = process.env.NODE_ENV
  const safeMode = process.env.DATABASE_SAFE_MODE
  
  // In production or safe mode, be extra cautious
  if (nodeEnv === 'production' || safeMode === 'true') {
    return false
  }
  
  return true
}

/**
 * Get a warning message for production database operations
 */
export function getProductionWarning(): string {
  return (
    '⚠️  WARNING: Database operations in production/safe mode\n' +
    'Consider using migrations instead of db push in production.'
  )
}

/**
 * Log a database operation for audit trail
 */
export function logDatabaseOperation(operation: string, details?: Record<string, any>): void {
  const timestamp = new Date().toISOString()
  const logEntry = {
    timestamp,
    operation,
    ...details,
  }
  
  // In a real application, you might want to write this to a file or logging service
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DB Safety]', logEntry)
  }
}


