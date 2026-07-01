import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordFailedLoginAttempt,
  resetLoginRateLimitForTests,
} from '@/lib/login-rate-limit'

function requestFor(ip: string) {
  return new Request('http://test/api/auth/login', {
    headers: { 'x-forwarded-for': ip },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  resetLoginRateLimitForTests()
})

afterEach(() => {
  resetLoginRateLimitForTests()
  vi.useRealTimers()
})

describe('login rate limit helper', () => {
  it('locks repeated failures for the same IP and email', () => {
    const request = requestFor('203.0.113.10')
    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit(request, 'admin@example.com').limited).toBe(false)
      recordFailedLoginAttempt(request, 'admin@example.com')
    }

    expect(checkLoginRateLimit(request, 'admin@example.com')).toMatchObject({
      limited: true,
      remainingTime: 15,
    })
    expect(checkLoginRateLimit(request, 'other@example.com').limited).toBe(false)
  })

  it('locks IP-level spraying across many emails', () => {
    const request = requestFor('203.0.113.11')
    for (let i = 0; i < 25; i++) {
      recordFailedLoginAttempt(request, `user-${i}@example.com`)
    }

    expect(checkLoginRateLimit(request, 'new-target@example.com').limited).toBe(true)
  })

  it('clears a successful login and expires old attempts', () => {
    const request = requestFor('203.0.113.12')
    for (let i = 0; i < 5; i++) recordFailedLoginAttempt(request, 'admin@example.com')
    expect(checkLoginRateLimit(request, 'admin@example.com').limited).toBe(true)

    clearLoginAttempts(request, 'admin@example.com')
    expect(checkLoginRateLimit(request, 'admin@example.com').limited).toBe(false)

    for (let i = 0; i < 5; i++) recordFailedLoginAttempt(request, 'admin@example.com')
    vi.advanceTimersByTime(16 * 60 * 1000)
    expect(checkLoginRateLimit(request, 'admin@example.com').limited).toBe(false)
  })
})
