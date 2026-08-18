/**
 * Review queue — the order the VA walks invoices in the review workspace.
 *
 * Ordering rule (from the invoicing handoff): flat-rate clients come before
 * per-clean ones because flat rates are faster to approve, and within each of
 * those the invoices that need attention come first. Anything already scheduled
 * to send drops to the end — it needs no decision today. Ties break
 * alphabetically by client so the order is stable between loads.
 */

export interface QueueItem {
  candidateId: string
  clientName: string
  /** FLAT_RATE | PER_CLEAN */
  billingType: string
  /** Candidate status; NEEDS_ATTENTION sorts ahead of the rest. */
  status: string
  /** Already queued to auto-send, so it needs no review now. */
  scheduled?: boolean
}

/** Lower sorts earlier. Mirrors the design's priority buckets exactly. */
export function queuePriority(item: QueueItem): number {
  if (item.scheduled) return 4
  const perClean = item.billingType !== "FLAT_RATE" ? 2 : 0
  const needsAttention = item.status === "NEEDS_ATTENTION" ? 0 : 1
  return perClean + needsAttention
}

export function orderQueue<T extends QueueItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => queuePriority(a) - queuePriority(b) || a.clientName.localeCompare(b.clientName),
  )
}

/** 1-based position of an invoice in the queue; 0 when it is not queued. */
export function queuePosition(items: QueueItem[], candidateId: string | null): number {
  if (!candidateId) return 0
  return items.findIndex(i => i.candidateId === candidateId) + 1
}

/** "3 of 7 to send", or null when there is nothing queued. */
export function queueLabel(items: QueueItem[], candidateId: string | null): string | null {
  if (items.length === 0) return null
  const pos = queuePosition(items, candidateId)
  return `${pos > 0 ? pos : "-"} of ${items.length} to send`
}

export function queueProgressPct(items: QueueItem[], candidateId: string | null): number {
  const pos = queuePosition(items, candidateId)
  if (items.length === 0 || pos === 0) return 0
  return Math.round((pos / items.length) * 100)
}

/**
 * The neighbour to move to. Stepping off either end stops rather than wrapping,
 * so the VA cannot silently loop back to the start of the queue.
 */
export function stepQueue<T extends QueueItem>(
  items: T[],
  candidateId: string | null,
  delta: number,
): T | null {
  if (items.length === 0) return null
  const index = items.findIndex(i => i.candidateId === candidateId)
  if (index < 0) return delta > 0 ? items[0] : items[items.length - 1]
  return items[index + delta] ?? null
}
