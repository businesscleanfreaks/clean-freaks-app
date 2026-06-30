import { describe, it, expect } from 'vitest'
import { parseZelleNotification } from '@/lib/zelle-parse'

// NOTE: these are representative formats. Replace/extend with Grace's REAL Zelle
// notification samples before trusting the parser on live mail.
describe('parseZelleNotification', () => {
  it('parses "You received $X from NAME" + a confirmation number', () => {
    const r = parseZelleNotification(
      'You received $420.00 from SOUZI ZEROUNIAN',
      'Zelle® payment. Confirmation number: BAC123XYZ. Deposited to your account.',
    )
    expect(r).not.toBeNull()
    expect(r!.amount).toBe(420)
    expect(r!.senderName).toBe('SOUZI ZEROUNIAN')
    expect(r!.confirmationNumber).toBe('BAC123XYZ')
  })

  it('parses "NAME sent you $X" with a comma in the amount', () => {
    const r = parseZelleNotification(
      'Chase Zelle',
      'VISIONNAIRE LIFESTYLE sent you $1,234.56 via Zelle.',
    )
    expect(r).not.toBeNull()
    expect(r!.amount).toBe(1234.56)
    expect(r!.senderName).toBe('VISIONNAIRE LIFESTYLE')
  })

  it('returns null for a normal, non-payment email', () => {
    expect(parseZelleNotification('Lunch?', 'Are we still on for lunch tomorrow?')).toBeNull()
  })

  it('returns null when it looks like Zelle but has no amount', () => {
    expect(parseZelleNotification('You received a Zelle payment', 'from SOMEONE')).toBeNull()
  })
})
