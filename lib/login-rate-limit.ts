const MAX_ACCOUNT_ATTEMPTS = 5
const MAX_IP_ATTEMPTS = 25
const LOCKOUT_DURATION_MS = 15 * 60 * 1000
const MAX_TRACKED_KEYS = 1000

type AttemptBucket = { count: number; lastAttempt: number }

const loginAttempts = new Map<string, AttemptBucket>()

function now() {
  return Date.now()
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function pruneExpired(currentTime = now()) {
  for (const [key, attempts] of loginAttempts.entries()) {
    if (currentTime - attempts.lastAttempt > LOCKOUT_DURATION_MS) {
      loginAttempts.delete(key)
    }
  }
}

function enforceMapCap() {
  if (loginAttempts.size <= MAX_TRACKED_KEYS) return
  const sorted = Array.from(loginAttempts.entries()).sort((a, b) => a[1].lastAttempt - b[1].lastAttempt)
  for (const [key] of sorted.slice(0, loginAttempts.size - MAX_TRACKED_KEYS)) {
    loginAttempts.delete(key)
  }
}

export function getLoginClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const firstForwarded = forwarded?.split(',')[0]?.trim()
  return firstForwarded || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

function keysFor(request: Request, email: string) {
  const ip = getLoginClientIp(request)
  const normalizedEmail = normalizeEmail(email)
  return {
    ipKey: `ip:${ip}`,
    accountKey: `ip-email:${ip}:${normalizedEmail}`,
  }
}

function checkKey(key: string, maxAttempts: number, currentTime = now()) {
  pruneExpired(currentTime)
  const attempts = loginAttempts.get(key)
  if (!attempts) return { limited: false as const }

  const timeSinceLastAttempt = currentTime - attempts.lastAttempt
  if (timeSinceLastAttempt > LOCKOUT_DURATION_MS) {
    loginAttempts.delete(key)
    return { limited: false as const }
  }

  if (attempts.count >= maxAttempts) {
    const remainingTime = Math.max(1, Math.ceil((LOCKOUT_DURATION_MS - timeSinceLastAttempt) / 1000 / 60))
    return { limited: true as const, remainingTime }
  }

  return { limited: false as const }
}

function recordKey(key: string) {
  pruneExpired()
  const attempts = loginAttempts.get(key)
  if (attempts) {
    attempts.count += 1
    attempts.lastAttempt = now()
  } else {
    loginAttempts.set(key, { count: 1, lastAttempt: now() })
  }
  enforceMapCap()
}

export function checkLoginRateLimit(request: Request, email: string): { limited: boolean; remainingTime?: number } {
  const { ipKey, accountKey } = keysFor(request, email)
  const ipLimit = checkKey(ipKey, MAX_IP_ATTEMPTS)
  if (ipLimit.limited) return ipLimit
  return checkKey(accountKey, MAX_ACCOUNT_ATTEMPTS)
}

export function recordFailedLoginAttempt(request: Request, email: string): void {
  const { ipKey, accountKey } = keysFor(request, email)
  recordKey(ipKey)
  recordKey(accountKey)
}

export function clearLoginAttempts(request: Request, email: string): void {
  const { ipKey, accountKey } = keysFor(request, email)
  loginAttempts.delete(accountKey)
  loginAttempts.delete(ipKey)
}

export function resetLoginRateLimitForTests(): void {
  loginAttempts.clear()
}
