/**
 * Team management rules. Everyone on the team has full access (there are no
 * roles), so the safety rules here are about never locking the business out of
 * its own account.
 */

export const MIN_PASSWORD_LENGTH = 8

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(normalizeEmail(email))
}

export interface NewTeammateInput {
  name: string
  email: string
  password: string
}

/** Returns an error message, or null when the input is valid. */
export function validateNewTeammate(input: NewTeammateInput): string | null {
  if (!input.name?.trim()) return 'Name is required.'
  if (!input.email?.trim()) return 'Email is required.'
  if (!isValidEmail(input.email)) return 'Enter a valid email address.'
  if (!input.password) return 'Password is required.'
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
  }
  return null
}

/**
 * Guards for removing a teammate. Prevents the two ways an operator could lock
 * themselves out: deleting their own account, or deleting the last one.
 * Returns an error message, or null when the removal is allowed.
 */
export function validateRemoval(params: {
  targetUserId: string
  currentUserId: string
  totalUserCount: number
}): string | null {
  if (params.targetUserId === params.currentUserId) {
    return 'You cannot remove your own account.'
  }
  if (params.totalUserCount <= 1) {
    return 'You cannot remove the last account.'
  }
  return null
}

export function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}
