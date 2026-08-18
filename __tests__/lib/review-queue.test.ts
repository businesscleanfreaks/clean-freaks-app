import { describe, expect, it } from 'vitest'
import {
  queuePriority, orderQueue, queuePosition, queueLabel, queueProgressPct, stepQueue,
  type QueueItem,
} from '@/lib/review-queue'

const item = (over: Partial<QueueItem> & { candidateId: string }): QueueItem => ({
  clientName: 'Client',
  billingType: 'FLAT_RATE',
  status: 'READY',
  ...over,
})

describe('queuePriority', () => {
  it('puts flat rate ahead of per clean, and needs-attention first within each', () => {
    expect(queuePriority(item({ candidateId: '1', billingType: 'FLAT_RATE', status: 'NEEDS_ATTENTION' }))).toBe(0)
    expect(queuePriority(item({ candidateId: '2', billingType: 'FLAT_RATE', status: 'READY' }))).toBe(1)
    expect(queuePriority(item({ candidateId: '3', billingType: 'PER_CLEAN', status: 'NEEDS_ATTENTION' }))).toBe(2)
    expect(queuePriority(item({ candidateId: '4', billingType: 'PER_CLEAN', status: 'READY' }))).toBe(3)
  })

  it('drops anything already scheduled to the very end', () => {
    expect(queuePriority(item({ candidateId: '1', billingType: 'FLAT_RATE', status: 'NEEDS_ATTENTION', scheduled: true }))).toBe(4)
  })
})

describe('orderQueue', () => {
  it('sorts by bucket then alphabetically by client', () => {
    const ordered = orderQueue([
      item({ candidateId: 'd', clientName: 'Zeta', billingType: 'PER_CLEAN', status: 'READY' }),
      item({ candidateId: 'b', clientName: 'Beta', billingType: 'FLAT_RATE', status: 'READY' }),
      item({ candidateId: 'a', clientName: 'Alpha', billingType: 'FLAT_RATE', status: 'NEEDS_ATTENTION' }),
      item({ candidateId: 'c', clientName: 'Gamma', billingType: 'PER_CLEAN', status: 'NEEDS_ATTENTION' }),
    ])
    expect(ordered.map(i => i.candidateId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('breaks ties alphabetically so the order is stable', () => {
    const ordered = orderQueue([
      item({ candidateId: '2', clientName: 'Bravo' }),
      item({ candidateId: '1', clientName: 'Alpha' }),
    ])
    expect(ordered.map(i => i.clientName)).toEqual(['Alpha', 'Bravo'])
  })

  it('does not mutate the input', () => {
    const input = [item({ candidateId: '2', clientName: 'Zed' }), item({ candidateId: '1', clientName: 'Ann' })]
    orderQueue(input)
    expect(input.map(i => i.candidateId)).toEqual(['2', '1'])
  })
})

describe('position, label and progress', () => {
  const items = [item({ candidateId: 'a' }), item({ candidateId: 'b' }), item({ candidateId: 'c' })]

  it('reports a 1-based position', () => {
    expect(queuePosition(items, 'a')).toBe(1)
    expect(queuePosition(items, 'c')).toBe(3)
    expect(queuePosition(items, 'missing')).toBe(0)
    expect(queuePosition(items, null)).toBe(0)
  })

  it('labels the position, and returns null for an empty queue', () => {
    expect(queueLabel(items, 'b')).toBe('2 of 3 to send')
    expect(queueLabel(items, 'missing')).toBe('- of 3 to send')
    expect(queueLabel([], 'a')).toBeNull()
  })

  it('computes progress without dividing by zero', () => {
    expect(queueProgressPct(items, 'a')).toBe(33)
    expect(queueProgressPct(items, 'c')).toBe(100)
    expect(queueProgressPct([], 'a')).toBe(0)
    expect(queueProgressPct(items, null)).toBe(0)
  })
})

describe('stepQueue', () => {
  const items = [item({ candidateId: 'a' }), item({ candidateId: 'b' }), item({ candidateId: 'c' })]

  it('moves forward and back', () => {
    expect(stepQueue(items, 'a', 1)?.candidateId).toBe('b')
    expect(stepQueue(items, 'b', -1)?.candidateId).toBe('a')
  })

  it('stops at the ends rather than wrapping around', () => {
    expect(stepQueue(items, 'c', 1)).toBeNull()
    expect(stepQueue(items, 'a', -1)).toBeNull()
  })

  it('enters at the nearest end when nothing is selected', () => {
    expect(stepQueue(items, null, 1)?.candidateId).toBe('a')
    expect(stepQueue(items, null, -1)?.candidateId).toBe('c')
    expect(stepQueue([], null, 1)).toBeNull()
  })
})
