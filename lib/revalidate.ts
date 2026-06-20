import { revalidatePath } from 'next/cache'

/**
 * Centralized revalidation utility to ensure all related pages are refreshed
 * when data changes. This prevents stale data issues across the app.
 */

/**
 * Revalidate all pages that might be affected by a job change
 */
export function revalidateJobPages(clientId?: string) {
  revalidatePath('/')
  revalidatePath('/calendar')
  revalidatePath('/payables')
  if (clientId) {
    revalidatePath('/clients')
    revalidatePath(`/clients/${clientId}`)
  }
}

/**
 * Revalidate all pages that might be affected by a client change
 */
export function revalidateClientPages(clientId?: string) {
  revalidatePath('/')
  revalidatePath('/clients')
  revalidatePath('/calendar')
  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
  }
}

/**
 * Revalidate all pages that might be affected by a location change
 */
export function revalidateLocationPages(clientId: string) {
  revalidatePath('/')
  revalidatePath('/calendar')
  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
}

/**
 * Revalidate all pages that might be affected by a schedule change
 */
export function revalidateSchedulePages(clientId: string) {
  revalidatePath('/')
  revalidatePath('/calendar')
  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/payables') // Schedules affect cleaner balances
}

/**
 * Revalidate all pages that might be affected by a subcontractor (cleaner) change.
 * Cleaner payables now live in the consolidated /payables workspace.
 */
export function revalidateSubcontractorPages(subcontractorId?: string) {
  revalidatePath('/')
  revalidatePath('/payables')
  revalidatePath('/calendar')
  if (subcontractorId) revalidatePath('/payables')
}

/**
 * Revalidate all pages that might be affected by an invoice change
 */
export function revalidateInvoicePages(clientId?: string) {
  revalidatePath('/')
  revalidatePath('/invoices')
  revalidatePath('/calendar')
  revalidatePath('/payables') // Invoices affect job status which affects balances
  if (clientId) {
    revalidatePath('/clients')
    revalidatePath(`/clients/${clientId}`)
  }
}
