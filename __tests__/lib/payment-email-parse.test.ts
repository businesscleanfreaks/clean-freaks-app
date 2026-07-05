import { describe, expect, it } from 'vitest'
import { parsePaymentNotification } from '@/lib/payment-email-parse'

describe('parsePaymentNotification', () => {
  it('keeps parsing Chase Zelle notifications through the shared parser', () => {
    const parsed = parsePaymentNotification(
      'ACME PAYMENTS sent you money',
      [
        'Here are the details:',
        'Amount $420.00',
        'Sent on Jul 3, 2026',
        'Transaction number ZELLE12345',
        'Memo INV-1001',
      ].join('\n'),
    )

    expect(parsed).toMatchObject({
      source: 'ZELLE',
      senderName: 'ACME PAYMENTS',
      amount: 420,
      confirmationNumber: 'ZELLE12345',
      memo: 'INV-1001',
    })
  })

  it('parses a QuickBooks payment notification', () => {
    const parsed = parsePaymentNotification(
      'Payment received from ACME PAYMENTS',
      [
        'QuickBooks Payments',
        'Payment received from ACME PAYMENTS for invoice INV-1001.',
        'Payment amount: $1,240.50',
        'Payment date: July 3, 2026',
        'Payment ID: QBPMT123456',
      ].join('\n'),
    )

    expect(parsed).toMatchObject({
      source: 'QUICKBOOKS',
      senderName: 'ACME PAYMENTS',
      amount: 1240.5,
      confirmationNumber: 'QUICKBOOKS:QBPMT123456',
      memo: 'INV-1001.',
    })
    expect(parsed?.sentAt).toBeInstanceOf(Date)
  })

  it('parses a generic processor notification without a transaction id', () => {
    const parsed = parsePaymentNotification(
      'Invoice paid',
      [
        'Square',
        'Riverside Dance Academy paid invoice 2026-07.',
        'Amount received: $569.00',
      ].join('\n'),
    )

    expect(parsed).toMatchObject({
      source: 'SQUARE',
      senderName: 'Riverside Dance Academy',
      amount: 569,
      confirmationNumber: null,
      memo: null,
    })
  })

  it('ignores ordinary client emails', () => {
    expect(parsePaymentNotification('Schedule change', 'Can we move tomorrow to Friday?')).toBeNull()
  })
})
