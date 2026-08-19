import { describe, expect, it } from 'vitest'
import {
  agoLabel,
  buildTimeline,
  daysBetween,
  daysLate,
  fillReminderTemplate,
  primaryAction,
  reminderStage,
  replySubject,
  type TrackedInvoice,
} from '@/lib/invoice-tracking'

const NOW = new Date('2026-08-19T12:00:00')

/** A sent, unpaid invoice due on the given day. */
function sent(overrides: Partial<TrackedInvoice> = {}): TrackedInvoice {
  return {
    status: 'SENT',
    dateSent: new Date('2026-08-12T09:00:00'),
    dateDue: new Date('2026-08-26T00:00:00'),
    datePaid: null,
    clearingSince: null,
    ...overrides,
  }
}

describe('daysBetween / agoLabel', () => {
  it('counts calendar days, ignoring the time of day', () => {
    // 11pm to 1am the next day is one calendar day, not zero.
    expect(daysBetween(new Date('2026-08-18T23:00:00'), new Date('2026-08-19T01:00:00'))).toBe(1)
  })

  it('reads naturally instead of as a bare number', () => {
    expect(agoLabel(new Date('2026-08-19T08:00:00'), NOW)).toBe('today')
    expect(agoLabel(new Date('2026-08-18T08:00:00'), NOW)).toBe('1 day ago')
    expect(agoLabel(new Date('2026-08-12T08:00:00'), NOW)).toBe('7 days ago')
  })
})

describe('daysLate', () => {
  it('is zero before the due date', () => {
    expect(daysLate(sent(), NOW)).toBe(0)
  })

  it('counts days past the due date', () => {
    expect(daysLate(sent({ dateDue: new Date('2026-08-12T00:00:00') }), NOW)).toBe(7)
  })

  it('is never late once paid', () => {
    const paid = sent({ status: 'PAID', dateDue: new Date('2026-07-01T00:00:00'), datePaid: NOW })
    expect(daysLate(paid, NOW)).toBe(0)
  })

  it('a missing due date cannot make an invoice look late', () => {
    expect(daysLate(sent({ dateDue: null }), NOW)).toBe(0)
  })
})

describe('buildTimeline', () => {
  it('returns nothing for an invoice that has not been sent', () => {
    expect(buildTimeline(sent({ status: 'DRAFT' }), NOW)).toBeNull()
  })

  it('marks Sent done and Due pending while the invoice is not yet due', () => {
    const steps = buildTimeline(sent(), NOW)!
    expect(steps.map(s => s.state)).toEqual(['done', 'pending', 'pending'])
    expect(steps[0].sub).toBe('7 days ago')
    expect(steps[1].sub).toBe('Aug 26')
  })

  it('turns Due red and says Past due once overdue', () => {
    const steps = buildTimeline(sent({ dateDue: new Date('2026-08-12T00:00:00') }), NOW)!
    expect(steps[1].state).toBe('late')
    expect(steps[1].label).toBe('Due Aug 12')
    expect(steps[1].sub).toBe('Past due')
  })

  it('shows the clearing estimate on the last step', () => {
    const steps = buildTimeline(sent({ clearingSince: new Date('2026-08-17T00:00:00') }), NOW)!
    expect(steps[2].state).toBe('clearing')
    expect(steps[2].label).toBe('Clearing')
    expect(steps[2].sub).toBe('~Aug 24')
  })

  it('completes all three steps once paid', () => {
    const steps = buildTimeline(
      sent({ status: 'PAID', datePaid: new Date('2026-08-18T00:00:00') }),
      NOW,
    )!
    expect(steps.map(s => s.state)).toEqual(['done', 'done', 'done'])
    expect(steps[2].sub).toBe('1 day ago')
  })

  it('never shows a paid invoice as clearing, even with a stale clearing date', () => {
    const steps = buildTimeline(
      sent({ status: 'PAID', datePaid: NOW, clearingSince: new Date('2026-08-01T00:00:00') }),
      NOW,
    )!
    expect(steps[2].label).toBe('Paid')
    expect(steps[2].state).toBe('done')
  })

  it('does not claim a send date it does not have', () => {
    const steps = buildTimeline(sent({ dateSent: null }), NOW)!
    expect(steps[0].sub).toBe('not recorded')
  })
})

describe('reminderStage', () => {
  it('offers nothing before the invoice is due', () => {
    expect(reminderStage(sent(), {}, NOW)).toBeNull()
  })

  // The ladder from the README: 1-4 days late, 5-13, then 14+ is a phone call.
  it('walks the ladder at the documented boundaries', () => {
    const at = (days: number) => {
      const due = new Date(NOW)
      due.setDate(due.getDate() - days)
      return reminderStage(sent({ dateDue: due }), {}, NOW)
    }
    expect(at(1)!.stage).toBe(1)
    expect(at(4)!.stage).toBe(1)
    expect(at(5)!.stage).toBe(2)
    expect(at(13)!.stage).toBe(2)
    expect(at(14)!.stage).toBe(3)
    expect(at(60)!.stage).toBe(3)
  })

  it('marks only the last rung as a phone call', () => {
    const at = (days: number) => {
      const due = new Date(NOW)
      due.setDate(due.getDate() - days)
      return reminderStage(sent({ dateDue: due }), {}, NOW)!
    }
    expect(at(2).isCall).toBe(false)
    expect(at(8).isCall).toBe(false)
    expect(at(20).isCall).toBe(true)
  })

  it('accepts edited templates but keeps the stage logic', () => {
    const due = new Date(NOW)
    due.setDate(due.getDate() - 6)
    const stage = reminderStage(sent({ dateDue: due }), { s2: 'Custom second nudge' }, NOW)!
    expect(stage.stage).toBe(2)
    expect(stage.body).toBe('Custom second nudge')
  })
})

describe('fillReminderTemplate', () => {
  it('fills every token, including repeats', () => {
    const out = fillReminderTemplate('#NUM · AMT · DUE · DAYS days · again #NUM', {
      invoiceNumber: 'INV-1',
      amount: '$1,342.00',
      due: 'Aug 12',
      days: 7,
    })
    expect(out).toBe('#INV-1 · $1,342.00 · Aug 12 · 7 days · again #INV-1')
  })
})

describe('replySubject', () => {
  it('threads onto the original subject', () => {
    expect(replySubject('Invoice · Burbank · June', 'x')).toBe('Re: Invoice · Burbank · June')
  })

  it('does not stack Re: on a subject that already has one', () => {
    expect(replySubject('Re: Invoice 12', 'x')).toBe('Re: Invoice 12')
    expect(replySubject('RE: Invoice 12', 'x')).toBe('RE: Invoice 12')
  })

  it('falls back when the original subject was never recorded', () => {
    expect(replySubject(null, 'Invoice INV-9')).toBe('Re: Invoice INV-9')
  })
})

describe('primaryAction', () => {
  it('offers exactly one action per state', () => {
    const overdue = new Date(NOW)
    overdue.setDate(overdue.getDate() - 3)
    const veryOverdue = new Date(NOW)
    veryOverdue.setDate(veryOverdue.getDate() - 30)

    expect(primaryAction(sent(), NOW)).toBe('mark-paid')
    expect(primaryAction(sent({ dateDue: overdue }), NOW)).toBe('remind')
    expect(primaryAction(sent({ dateDue: veryOverdue }), NOW)).toBe('call')
    expect(primaryAction(sent({ clearingSince: NOW }), NOW)).toBe('confirm-deposit')
    expect(primaryAction(sent({ status: 'PAID', datePaid: NOW }), NOW)).toBe('none')
    expect(primaryAction(sent({ status: 'DRAFT' }), NOW)).toBe('none')
  })

  it('confirming a deposit outranks chasing a late payment', () => {
    // A payment already in flight should not be chased with a reminder.
    const overdue = new Date(NOW)
    overdue.setDate(overdue.getDate() - 9)
    expect(primaryAction(sent({ dateDue: overdue, clearingSince: NOW }), NOW)).toBe('confirm-deposit')
  })
})
