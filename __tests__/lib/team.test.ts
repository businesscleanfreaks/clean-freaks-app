import { describe, expect, it } from 'vitest'
import {
  validateNewTeammate,
  validateRemoval,
  normalizeEmail,
  isValidEmail,
  initialsOf,
  MIN_PASSWORD_LENGTH,
} from '@/lib/team'

const valid = { name: 'Grace', email: 'Grace@Example.com ', password: 'a-strong-pass' }

describe('validateNewTeammate', () => {
  it('accepts a complete teammate', () => {
    expect(validateNewTeammate(valid)).toBeNull()
  })

  it('requires name, email, and password', () => {
    expect(validateNewTeammate({ ...valid, name: '  ' })).toMatch(/name/i)
    expect(validateNewTeammate({ ...valid, email: '' })).toMatch(/email/i)
    expect(validateNewTeammate({ ...valid, password: '' })).toMatch(/password/i)
  })

  it('rejects a malformed email', () => {
    expect(validateNewTeammate({ ...valid, email: 'not-an-email' })).toMatch(/valid email/i)
  })

  it(`rejects a password shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(validateNewTeammate({ ...valid, password: 'short' })).toMatch(/at least/i)
  })
})

describe('validateRemoval — lockout guards', () => {
  const base = { targetUserId: 'other', currentUserId: 'me', totalUserCount: 3 }

  it('allows removing another teammate when others remain', () => {
    expect(validateRemoval(base)).toBeNull()
  })

  it('blocks removing your own account', () => {
    expect(validateRemoval({ ...base, targetUserId: 'me' })).toMatch(/your own account/i)
  })

  it('blocks removing the last remaining account', () => {
    expect(validateRemoval({ ...base, totalUserCount: 1 })).toMatch(/last account/i)
  })

  it('blocks self-removal even when it is also the last account', () => {
    expect(validateRemoval({ targetUserId: 'me', currentUserId: 'me', totalUserCount: 1 })).not.toBeNull()
  })
})

describe('email helpers', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeEmail('  Grace@Example.COM ')).toBe('grace@example.com')
  })

  it('validates format', () => {
    expect(isValidEmail('grace@example.com')).toBe(true)
    expect(isValidEmail('grace@')).toBe(false)
    expect(isValidEmail('grace example.com')).toBe(false)
  })
})

describe('initialsOf', () => {
  it('uses the name when present', () => {
    expect(initialsOf('Grace Hopper', 'g@example.com')).toBe('GH')
    expect(initialsOf('Grace', 'g@example.com')).toBe('G')
  })

  it('falls back to the email when there is no name', () => {
    expect(initialsOf(null, 'grace.hopper@example.com')).toBe('GH')
  })
})
