/**
 * Environment Variable Validation Utility
 * Validates required and optional environment variables at startup
 */

import { logger } from './logger'

interface EnvVar {
  name: string
  required: boolean
  description: string
  validator?: (value: string) => boolean | string
  defaultValue?: string
}

const envVars: EnvVar[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    description: 'Database connection string',
    validator: (value) => {
      if (!value) return 'DATABASE_URL is required'
      if (!value.startsWith('file:') && !value.startsWith('postgresql://') && !value.startsWith('mysql://')) {
        return 'DATABASE_URL must start with file:, postgresql://, or mysql://'
      }
      return true
    },
  },
  {
    name: 'NODE_ENV',
    required: false,
    description: 'Node environment (development or production)',
    defaultValue: 'development',
    validator: (value) => {
      const valid = ['development', 'production', 'test']
      if (value && !valid.includes(value)) {
        return `NODE_ENV must be one of: ${valid.join(', ')}`
      }
      return true
    },
  },
  {
    name: 'SMTP_HOST',
    required: false,
    description: 'SMTP server hostname for email',
  },
  {
    name: 'SMTP_PORT',
    required: false,
    description: 'SMTP server port',
    validator: (value) => {
      if (value) {
        const port = parseInt(value, 10)
        if (isNaN(port) || port < 1 || port > 65535) {
          return 'SMTP_PORT must be a valid port number (1-65535)'
        }
      }
      return true
    },
  },
  {
    name: 'SMTP_USER',
    required: false,
    description: 'SMTP username/email',
  },
  {
    name: 'SMTP_PASSWORD',
    required: false,
    description: 'SMTP password',
  },
  {
    name: 'SMTP_FROM',
    required: false,
    description: 'Default sender email address',
  },
  {
    name: 'QUICKBOOKS_CLIENT_ID',
    required: false,
    description: 'QuickBooks OAuth client ID',
  },
  {
    name: 'QUICKBOOKS_CLIENT_SECRET',
    required: false,
    description: 'QuickBooks OAuth client secret',
  },
  {
    name: 'QUICKBOOKS_ENVIRONMENT',
    required: false,
    description: 'QuickBooks environment (sandbox or production)',
    defaultValue: 'sandbox',
    validator: (value) => {
      if (value && !['sandbox', 'production'].includes(value)) {
        return 'QUICKBOOKS_ENVIRONMENT must be "sandbox" or "production"'
      }
      return true
    },
  },
  {
    name: 'SESSION_SECRET',
    required: false,
    description: 'Secret key for session encryption',
    validator: (value) => {
      if (value && value.length < 32) {
        return 'SESSION_SECRET should be at least 32 characters long for security'
      }
      return true
    },
  },
]

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate all environment variables
 */
export function validateEnv(): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const envVar of envVars) {
    const value = process.env[envVar.name] || envVar.defaultValue

    // Check required variables
    if (envVar.required && !value) {
      errors.push(`Missing required environment variable: ${envVar.name} - ${envVar.description}`)
      continue
    }

    // Skip validation if variable is not set and not required
    if (!value) {
      continue
    }

    // Run custom validator if provided
    if (envVar.validator) {
      const result = envVar.validator(value)
      if (result !== true) {
        if (envVar.required) {
          errors.push(`${envVar.name}: ${result}`)
        } else {
          warnings.push(`${envVar.name}: ${result}`)
        }
      }
    }
  }

  // Special validation for email configuration
  const hasPartialEmailConfig = 
    (process.env.SMTP_HOST || process.env.SMTP_USER || process.env.SMTP_PASSWORD) &&
    !(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD)

  if (hasPartialEmailConfig) {
    warnings.push('Email configuration is incomplete. SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are all required for email functionality.')
  }

  // Special validation for QuickBooks
  const hasPartialQbConfig =
    (process.env.QUICKBOOKS_CLIENT_ID || process.env.QUICKBOOKS_CLIENT_SECRET) &&
    !(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET)

  if (hasPartialQbConfig) {
    warnings.push('QuickBooks configuration is incomplete. Both QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET are required for QuickBooks integration.')
  }

  // Warning for weak session secret in production
  if (process.env.NODE_ENV === 'production' && process.env.SESSION_SECRET) {
    if (process.env.SESSION_SECRET.length < 32) {
      warnings.push('SESSION_SECRET is too short for production. Use at least 32 characters.')
    }
    if (process.env.SESSION_SECRET === 'change-this-to-a-random-secret-in-production') {
      warnings.push('SESSION_SECRET is still set to the default value. Change it before deploying to production.')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Log validation results
 */
export function logEnvValidation(): void {
  const result = validateEnv()

  if (result.errors.length > 0) {
    logger.error('Environment validation failed:')
    result.errors.forEach(error => logger.error(`  - ${error}`))
  }

  if (result.warnings.length > 0) {
    logger.warn('Environment validation warnings:')
    result.warnings.forEach(warning => logger.warn(`  - ${warning}`))
  }

  if (result.valid && result.warnings.length === 0) {
    logger.info('Environment variables validated successfully')
  }
}

/**
 * Get a validated environment variable with fallback
 */
export function getEnvVar(name: string, defaultValue?: string): string | undefined {
  const envVar = envVars.find(v => v.name === name)
  return process.env[name] || envVar?.defaultValue || defaultValue
}

/**
 * Require an environment variable (throws if missing)
 */
export function requireEnvVar(name: string): string {
  const value = process.env[name]
  if (!value) {
    const envVar = envVars.find(v => v.name === name)
    throw new Error(`Required environment variable ${name} is missing. ${envVar?.description || ''}`)
  }
  return value
}


