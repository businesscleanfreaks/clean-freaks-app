import { prisma } from '@/lib/db'

/** The IRS threshold at/above which a 1099-NEC is generally required. */
export const THRESHOLD_1099 = 600
/** Cleaners within this much of the threshold are "approaching" (collect a W-9 early). */
export const APPROACHING_1099 = 500

export interface Cleaner1099Row {
  id: string
  name: string
  email: string | null
  phone: string | null
  total: number
  paymentCount: number
}

export interface Payout1099Summary {
  year: number
  cleanerCount: number
  over600Count: number
  approachingCount: number
  totalPaid: number
}

/**
 * Per-cleaner payout totals for a calendar year, summed from recorded
 * subcontractor payments. Sorted highest-paid first.
 */

// start: Sets the time to January 1st at 00:00:00.000 UTC.0 represents January (months are 0-indexed in JavaScript).
// 1 represents the 1st day of the month.
// end: Sets the time to December 31st at 23:59:59.999 UTC.
// 11 represents December.31 represents the 31st day of the month.999 captures the very last millisecond of the year.
export async function getCleaner1099Totals(year: number): Promise<Cleaner1099Row[]> {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0))
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))

  const payments = await prisma.subcontractorPayment.findMany({
    where: { datePaid: { gte: start, lte: end } },
    select: {
      subcontractorId: true,
      totalAmount: true,
      subcontractor: { select: { name: true, email: true, phone: true } },
    },
  })

  const byCleaner = new Map<string, Cleaner1099Row>()
  for (const p of payments) {
    const existing = byCleaner.get(p.subcontractorId)
    // p.totalAmount (Current Payment Amount)
    // What it is: The specific dollar amount of a single, individual payment record currently being processed inside the loop.

    // existing.total (Total Amount)
    // What it is: The cumulative, running sum of all money paid to that specific cleaner across the entire dataset. 
    // It lives inside the byCleaner map and grows larger every time the loop finds another payment belonging to the same person.
    
    // existing Check: For every payment (p) in the loop, it checks if that cleaner is already in the Map.
    if (existing) {
      existing.total += p.totalAmount
      existing.paymentCount += 1
    } else {
      // If not found (false): It adds a new entry to the Map, safely pulling the cleaner's name, email, and phone while defaulting to 'Unknown' or null if they are missing.
      byCleaner.set(p.subcontractorId, {
        id: p.subcontractorId,
        name: p.subcontractor?.name ?? 'Unknown',
        email: p.subcontractor?.email ?? null,
        phone: p.subcontractor?.phone ?? null,
        total: p.totalAmount,
        paymentCount: 1,
      })
    }
  }

  return Array.from(byCleaner.values()).sort((a, b) => b.total - a.total)
}

export function summarize1099(year: number, rows: Cleaner1099Row[]): Payout1099Summary {
  return {
    year,
    cleanerCount: rows.length,
    over600Count: rows.filter((r) => r.total >= THRESHOLD_1099).length,
    approachingCount: rows.filter((r) => r.total >= APPROACHING_1099 && r.total < THRESHOLD_1099).length,
    totalPaid: rows.reduce((sum, r) => sum + r.total, 0),     // The gross sum of all payouts made to all contractors combined for that year.
  }
}

export function build1099Csv(year: number, rows: Cleaner1099Row[]): string {
  const esc = (v: string) => (v || '').replace(/,/g, ';')
  const lines: string[] = []
  lines.push(`Cleaner,Email,Phone,Payments,Total Paid ${year},1099 Required (>= $${THRESHOLD_1099})`)
  for (const r of rows) {
    lines.push(
      [
        esc(r.name),
        esc(r.email ?? ''),
        esc(r.phone ?? ''),
        String(r.paymentCount),
        r.total.toFixed(2),
        r.total >= THRESHOLD_1099 ? 'Yes' : 'No',
      ].join(','),
    )
  }
  return lines.join('\n')
}
