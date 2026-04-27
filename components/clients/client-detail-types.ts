import type { ClientWithDetails, ClientJobSummary } from "@/lib/types"

/** Schedule shape within ClientWithDetails locations */
export type ClientSchedule = ClientWithDetails['locations'][number]['schedules'][number]

/** Location shape within ClientWithDetails */
export type ClientLocation = ClientWithDetails['locations'][number]

/** Schedule with location context for the Add Job modal */
export interface ScheduleForModal extends ClientSchedule {
  locationId: string
  locationName: string
}

/** Subcontractor as returned by GET /api/subcontractors */
export interface SubcontractorRecord {
  id: string
  name: string
  phone: string | null
  email: string | null
}

/** Job shape enriched with location info for the job feed */
export interface JobWithLocation extends ClientJobSummary {
  location: { id: string; name: string }
}

/** Activity feed entry */
export interface ActivityEntry {
  type: 'completed' | 'paid' | 'invoice'
  title: string
  location?: string
  date: Date
  worker?: string
  amount?: number
}

/** Job data sent to POST /api/jobs */
export interface CreateJobPayload {
  scheduleId: string
  locationId: string
  subcontractorId: string | null
  date: string
  clientRate: number
  subcontractorRate: number
  status: string
  startTime?: string | null
  startWindowBegin?: string | null
  startWindowEnd?: string | null
}

/** Billing type literal union */
export type BillingType = 'FLAT_RATE' | 'PER_CLEAN'
export type ScheduleFormMode = 'edit' | 'future'
