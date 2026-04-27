/** Billing settings helpers */

import { startOfMonth } from 'date-fns'

/**
 * Returns the billing cycle start date.
 * Defaults to the 1st of the current month.
 */
export async function getBillingStartDate(): Promise<Date> {
  return startOfMonth(new Date())
}
