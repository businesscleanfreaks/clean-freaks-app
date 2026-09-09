/**
 * Allocating the next invoice number against the live database.
 *
 * Both creation routes used to read the highest number and then write it back,
 * which races: two invoices created at the same moment pick the same number
 * and the second one hits the unique index and 500s. Batch send creates
 * several invoices in quick succession, so this is not hypothetical.
 *
 * The rules for the number itself live in `lib/invoice-number.ts` and are
 * tested there. This is only the database half.
 */

import { prisma } from "./db"
import {
  INVOICE_NUMBER_RETRIES,
  isUniqueViolation,
  nextInvoiceNumber,
} from "./invoice-number"

/** Every number already used in `year`, in either format. */
async function numbersInUse(year: number): Promise<string[]> {
  const rows = await prisma.invoice.findMany({
    // Includes VOID and every other status on purpose: a number that has been
    // issued must not be handed out again, whatever happened to the invoice.
    where: { invoiceNumber: { startsWith: `INV-${year}-` } },
    select: { invoiceNumber: true },
  })
  return rows.map(r => r.invoiceNumber)
}

/** The next free number for this year. */
export async function allocateInvoiceNumber(now: Date = new Date()): Promise<string> {
  return nextInvoiceNumber(now.getFullYear(), await numbersInUse(now.getFullYear()))
}

/**
 * Create an invoice, retrying if another request took the number first.
 *
 * `create` receives the number to use. On a unique-constraint clash the number
 * is recomputed and the create is tried again, so simultaneous creates end up
 * with adjacent numbers instead of one of them failing.
 */
export async function createWithInvoiceNumber<T>(
  create: (invoiceNumber: string) => Promise<T>,
  now: Date = new Date(),
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < INVOICE_NUMBER_RETRIES; attempt++) {
    const invoiceNumber = await allocateInvoiceNumber(now)
    try {
      return await create(invoiceNumber)
    } catch (error) {
      // Only a number clash is worth retrying. Anything else is a real failure
      // and retrying it would just create the same problem five times.
      if (!isUniqueViolation(error)) throw error
      lastError = error
    }
  }
  throw lastError
}
