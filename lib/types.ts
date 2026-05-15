/**
 * Shared type definitions derived from Prisma models.
 *
 * These types describe the shapes returned by API routes and consumed by
 * components. Using Prisma.XGetPayload keeps them in sync with the schema.
 */

import type { Prisma } from '@prisma/client'

// ─── Client types ────────────────────────────────────────────────────────────

/** Full client detail — returned by GET /api/clients/[id] */
export type ClientWithDetails = Prisma.ClientGetPayload<{
  include: {
    locations: {
      include: {
        schedules: {
          include: {
            subcontractor: true
            recurringAddOnServices: true
          }
        }
        jobs: {
          select: {
            id: true
            date: true
            startTime: true
            status: true
            invoiced: true
            scheduleId: true
            clientRate: true
            subcontractorRate: true
            subcontractor: { select: { id: true; name: true } }
            schedule: { select: { id: true; frequency: true } }
          }
        }
      }
    }
    invoices: {
      select: {
        id: true
        status: true
        totalAmount: true
        dateCreated: true
      }
    }
    _count: { select: { locations: true } }
  }
}>

/** Client list item — returned by GET /api/clients */
export type ClientListItem = Prisma.ClientGetPayload<{
  include: {
    locations: {
      include: {
        schedules: true
      }
    }
  }
}>

/** Minimal client reference used in dropdowns and selectors */
export interface ClientSummary {
  id: string
  name: string
  phone: string | null
  communicationEmail: string | null
  invoicingEmail: string | null
}

// ─── Job types ───────────────────────────────────────────────────────────────

/** Job with relations — used in calendar dialogs and detail views */
export type JobWithRelations = Prisma.JobGetPayload<{
  include: {
    location: {
      include: { client: true }
    }
    subcontractor: true
    schedule: true
    addOnServices: true
    invoiceLineItems: {
      include: { invoice: true }
    }
  }
}>

/** Compact job as returned in client detail's location.jobs */
export interface ClientJobSummary {
  id: string
  date: string | Date
  startTime: string | null
  startWindowBegin?: string | null
  startWindowEnd?: string | null
  status: string
  invoiced: boolean
  scheduleId: string | null
  clientRate: number
  subcontractorRate: number
  subcontractor: { id: string; name: string } | null
  schedule: {
    id: string
    frequency: string
    daysOfWeek?: string | null
    defaultClientRate?: number | null
    defaultSubcontractorRate?: number | null
    timeType?: string | null
    startTime?: string | null
    startWindowBegin?: string | null
    startWindowEnd?: string | null
  } | null
}

// ─── Schedule types ──────────────────────────────────────────────────────────

export type ScheduleWithSubcontractor = Prisma.ScheduleGetPayload<{
  include: {
    subcontractor: true
    recurringAddOnServices: true
  }
}>

// ─── Location types ──────────────────────────────────────────────────────────

export type LocationWithSchedulesAndJobs = Prisma.LocationGetPayload<{
  include: {
    schedules: {
      include: {
        subcontractor: true
        recurringAddOnServices: true
      }
    }
    jobs: true
  }
}>

// ─── Invoice types ───────────────────────────────────────────────────────────

/** Invoice with client and line items — used in invoice detail/list */
export type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: {
    client: {
      include: { locations: true }
    }
    lineItems: {
      include: {
        job: {
          include: { location: true }
        }
      }
    }
  }
}>

/** Compact invoice summary as returned in client detail */
export interface InvoiceSummary {
  id: string
  status: string
  totalAmount: number
  dateCreated: string | Date
}

/** Job data used in invoice creation flows */
export interface InvoiceJob {
  id: string
  date: string | Date
  clientRate: number
  status: string
  invoiced: boolean
  scheduleId: string | null
  locationId: string
  location?: {
    id: string
    name: string
    address: string
    client?: { id: string; name: string }
  }
  subcontractor?: { id: string; name: string } | null
  addOnServices?: AddOnServiceRecord[]
}

// ─── Subcontractor types ─────────────────────────────────────────────────────

export type SubcontractorWithPayments = Prisma.SubcontractorGetPayload<{
  include: {
    payments: true
    jobs: true
  }
}>

export interface SubcontractorSummary {
  id: string
  name: string
  phone: string | null
  email: string | null
  isActive?: boolean
}

// ─── Expense types ───────────────────────────────────────────────────────────

/** Expense record — matches what GET /api/expenses returns */
export interface ExpenseRecord {
  id: string
  date: string | Date
  amount: number
  description: string
  category: string | null
  type: string | null
  vendor: string | null
  receiptUrl: string | null
  notes: string | null
  isRecurring: boolean
  qbSynced: boolean
  qbExpenseId: string | null
  qbSyncedAt: string | Date | null
  qbCategory: string | null
  qbAccountType: string | null
  isCleanerPay: boolean
  createdAt: string | Date
  updatedAt: string | Date
}

// ─── Add-on service types ────────────────────────────────────────────────────

export interface AddOnServiceRecord {
  id: string
  jobId: string | null
  scheduleId: string | null
  description: string
  clientRate: number
  subcontractorRate: number
  frequency: string | null
  isRecurring: boolean
}

// ─── Inbox / messaging types ─────────────────────────────────────────────────

/** Client shape as used by the inbox (from GET /api/clients — same as ClientListItem but typed for inbox use) */
export interface InboxClientRecord {
  id: string
  name: string
  phone: string | null
  communicationEmail: string | null
  invoicingEmail: string | null
  isActive: boolean
  locations?: Array<{
    id: string
    name: string
    address: string
    schedules?: Array<{ id: string }>
  }>
}
