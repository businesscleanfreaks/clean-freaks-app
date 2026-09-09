/**
 * Invoice numbers.
 *
 * Josh's design notes, 2026-09-08 (C2): `INV-YYYY-NNN`, sequential within the
 * year, never reused, stored on the invoice.
 *
 * It replaces `INV-YYYYMMDD-NNNN`, which restarted at 0001 every day. Two
 * invoices a week apart could be numbered 0001 and 0001, so the number told a
 * client nothing about order and told the business nothing about how many had
 * been raised.
 *
 * The old format is still on existing invoices and is left alone. The two are
 * distinguishable: `INV-2026-131` has a four-digit year followed by a dash,
 * `INV-20260907-0001` has eight digits, so the parser below matches one and
 * not the other and the sequence never counts an old number as a new one.
 *
 * Pure: no Prisma. The caller supplies the numbers already in use, which is
 * what makes the collision retry in the route testable as a plain loop.
 */

/** `INV-2026-131`. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(3, "0")}`
}

/**
 * The sequence inside a number of the CURRENT format, or null.
 *
 * Deliberately strict: exactly four digits for the year, so a date-stamped
 * `INV-20260907-0001` is not read as sequence 1 of year 20260907.
 */
export function parseInvoiceNumber(value: string): { year: number; sequence: number } | null {
  const match = /^INV-(\d{4})-(\d+)$/.exec(String(value ?? "").trim())
  if (!match) return null
  return { year: Number(match[1]), sequence: Number(match[2]) }
}

/**
 * The next number for a year, given every number already in use.
 *
 * Takes the highest and adds one rather than filling gaps: a number that has
 * been on a client's invoice must never appear on a different one, even if
 * that invoice was later voided or deleted.
 */
export function nextInvoiceNumber(year: number, existingNumbers: readonly string[]): string {
  let highest = 0
  for (const value of existingNumbers) {
    const parsed = parseInvoiceNumber(value)
    if (parsed && parsed.year === year && parsed.sequence > highest) highest = parsed.sequence
  }
  return formatInvoiceNumber(year, highest + 1)
}

/** How many times to retry when two creates pick the same number at once. */
export const INVOICE_NUMBER_RETRIES = 5

/** True when a Prisma error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === "P2002"
}
