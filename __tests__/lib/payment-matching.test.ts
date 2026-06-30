import { describe, it, expect } from 'vitest'
import { scoreMatch, normalizeSenderName, type OpenInvoice } from '@/lib/payment-matching'

const inv = (id: string, clientId: string, totalAmount: number): OpenInvoice => ({ id, clientId, totalAmount })

describe('normalizeSenderName', () => {
  it('uppercases and strips punctuation + company suffixes', () => {
    expect(normalizeSenderName('Visionnaire Lifestyle, LLC')).toBe('VISIONNAIRE LIFESTYLE')
    expect(normalizeSenderName('  souzi   zerounian ')).toBe('SOUZI ZEROUNIAN')
  })
})

describe('scoreMatch', () => {
  const alias = new Map([['SOUZI ZEROUNIAN', 'client-souzi']])

  it('HIGH: known payer + exactly one exact-amount invoice for that client', () => {
    const r = scoreMatch(
      { senderName: 'Souzi Zerounian', amount: 420 },
      [inv('i1', 'client-souzi', 420), inv('i2', 'client-other', 420)],
      alias,
    )
    expect(r.confidence).toBe('HIGH')
    expect(r.suggestedInvoiceId).toBe('i1')
  })

  it('MEDIUM: unknown payer + a single exact-amount invoice overall', () => {
    const r = scoreMatch({ senderName: 'New Person', amount: 99 }, [inv('i1', 'c1', 99)], new Map())
    expect(r.confidence).toBe('MEDIUM')
    expect(r.suggestedInvoiceId).toBe('i1')
  })

  it('REVIEW: unknown payer, amount matches multiple invoices → no auto-suggestion', () => {
    const r = scoreMatch(
      { senderName: 'X', amount: 99 },
      [inv('i1', 'c1', 99), inv('i2', 'c2', 99)],
      new Map(),
    )
    expect(r.confidence).toBe('REVIEW')
    expect(r.suggestedInvoiceId).toBeNull()
    expect(r.candidateInvoiceIds).toEqual(['i1', 'i2'])
  })

  it('REVIEW: known payer but no exact-amount invoice → surfaces that client\'s open invoices', () => {
    const r = scoreMatch(
      { senderName: 'Souzi Zerounian', amount: 500 },
      [inv('i1', 'client-souzi', 420)],
      alias,
    )
    expect(r.confidence).toBe('REVIEW')
    expect(r.suggestedInvoiceId).toBeNull()
    expect(r.candidateInvoiceIds).toEqual(['i1'])
    expect(r.resolvedClientId).toBe('client-souzi')
  })
})
