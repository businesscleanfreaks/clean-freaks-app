// Generated TypeScript interfaces from Prisma schema

export interface Client {
  id: string
  name: string
  phone: string | null
  communicationEmail: string | null
  invoicingEmail: string | null
  notes: string | null
  billingType: 'FLAT_RATE' | 'PER_CLEAN'
  cleanerPayType: 'FLAT_RATE' | 'PER_CLEAN'
  preferredPaymentMethod: string | null
  startDate: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  locations?: Location[]
  invoices?: Invoice[]
}

export interface Location {
  id: string
  clientId: string
  address: string
  name: string
  accessInfo: string | null
  latitude: number | null
  longitude: number | null
  createdAt: Date
  client?: Client
  schedules?: Schedule[]
  jobs?: Job[]
}

export interface Subcontractor {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  teamMembers: string | null
  paymentCadence: string
  paymentCadenceNotes: string | null
  excludeClientIds: string | null
  createdAt: Date
  schedules?: Schedule[]
  jobs?: Job[]
  payments?: SubcontractorPayment[]
}

export interface Job {
  id: string
  locationId: string
  subcontractorId: string | null
  scheduleId: string | null
  date: Date
  startTime: string | null
  startWindowBegin: string | null
  startWindowEnd: string | null
  clientRate: number
  subcontractorRate: number
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  invoiced: boolean
  subcontractorPaid: boolean
  createdAt: Date
  updatedAt: Date
  location?: Location
  subcontractor?: Subcontractor | null
  schedule?: Schedule | null
  invoiceLineItems?: InvoiceLineItem[]
  paymentLineItems?: SubcontractorPaymentLineItem[]
  addOnServices?: AddOnService[]
}

export interface Schedule {
  id: string
  locationId: string
  subcontractorId: string | null
  frequency: 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY' | 'CUSTOM'
  daysOfWeek: string | null
  customDates: string | null
  timeType: 'SPECIFIC' | 'WINDOW'
  startTime: string | null
  startWindowBegin: string | null
  startWindowEnd: string | null
  defaultClientRate: number
  defaultSubcontractorRate: number
  startDate: Date
  endDate: Date | null
  isActive: boolean
  paymentCadenceOverride: string | null
  createdAt: Date
  updatedAt: Date
  location?: Location
  subcontractor?: Subcontractor | null
  jobs?: Job[]
  recurringAddOnServices?: AddOnService[]
}

export interface Invoice {
  id: string
  invoiceNumber: string
  clientId: string
  dateCreated: Date
  dateDue: Date | null
  totalAmount: number
  status: 'DRAFT' | 'SENT' | 'PAID'
  pdfPath: string | null
  pdfUrl: string | null
  notes: string | null
  dateSent: Date | null
  sentTo: string | null
  emailSubject: string | null
  emailBody: string | null
  showPaymentOptions: boolean
  createdAt: Date
  updatedAt?: Date | null
  client?: Client
  lineItems?: InvoiceLineItem[]
}

export interface InvoiceLineItem {
  id: string
  invoiceId: string
  jobId: string | null
  addOnServiceId: string | null
  description: string
  amount: number
  serviceDate: Date | null
  invoice?: Invoice
  job?: Job | null
  addOnService?: AddOnService | null
}

export interface SubcontractorPayment {
  id: string
  subcontractorId: string
  datePaid: Date
  totalAmount: number
  notes: string | null
  createdAt: Date
  subcontractor?: Subcontractor
  lineItems?: SubcontractorPaymentLineItem[]
}

export interface SubcontractorPaymentLineItem {
  id: string
  paymentId: string
  jobId: string
  amount: number
  payment?: SubcontractorPayment
  job?: Job
}

export interface AddOnService {
  id: string
  jobId: string | null
  scheduleId: string | null
  description: string
  clientRate: number
  subcontractorRate: number
  frequency: string | null
  isRecurring: boolean
  outsourcedVendor: string | null
  vendorId: string | null
  vendorPaid: boolean
  createdAt: Date
  updatedAt: Date
  job?: Job | null
  schedule?: Schedule | null
  invoiceLineItems?: InvoiceLineItem[]
}

// Specific types for invoice with full relations
export interface InvoiceWithRelations extends Invoice {
  client: Client & {
    communicationContactName?: string | null
    communicationPhone?: string | null
    locations: Array<{
      id: string
      address: string
      name: string
      city?: string | null
      state?: string | null
      zipCode?: string | null
    }>
  }
  lineItems: Array<InvoiceLineItem & {
    job: Job & {
      location: Location
    } | null
  }>
}

// Client with jobs for batch invoicing
export interface ClientWithJobs {
  client: {
    id: string
    name: string
    billingType: 'FLAT_RATE' | 'PER_CLEAN'
  }
  jobs: Job[]
  totalAmount: number
  jobsThisMonth: number
}

// Job with location and client for invoice creation
export interface JobWithLocation extends Job {
  location: Location & {
    client: Client
  }
  addOnServices?: AddOnService[]
  schedule?: Schedule | null
}

// Client with locations for forms
export interface ClientWithLocations extends Client {
  locations: Location[]
}

// Job with full relations for calendar
export interface JobWithFullRelations extends Job {
  location: Location & {
    client: Client
  }
  subcontractor: Subcontractor | null
  schedule: Schedule | null
  invoiceLineItems?: Array<InvoiceLineItem & {
    invoice: Invoice | null
  }>
  addOnServices?: AddOnService[]
}

// Client with full relations for client detail view
export interface ClientWithFullRelations extends Client {
  locations: Array<Location & {
    jobs: Job[]
    schedules: Schedule[]
  }>
  invoices?: Invoice[]
}

// Schedule with optional relations
export interface ScheduleFormData extends Partial<Schedule> {
  id?: string
}

// ── Cleaner (Subcontractor) Page Types ──

export interface CleanerJob {
  id: string
  date: Date
  subcontractorRate: number
  subcontractorPaid: boolean
  scheduleId: string | null
  paidDate?: string | null
  location: {
    name: string
    address: string
    client: {
      id: string
      name: string
      billingType: string
      cleanerPayType?: string
    }
  }
}

export interface CleanerPayment {
  id: string
  datePaid: Date
  totalAmount: number
  notes: string | null
  lineItems: Array<{
    id: string
    amount: number
    job: {
      id: string
      date: Date
      location: {
        name: string
        client: {
          name: string
        }
      }
    }
  }>
}

export interface CleanerData {
  id: string
  name: string
  phone: string | null
  email: string | null
  teamMembers: string | null
  paymentCadence: string
  paymentCadenceNotes: string | null
  excludeClientIds: string | null
  owedAmount: number
  jobs: CleanerJob[]
  payments?: CleanerPayment[]
  paidJobs?: CleanerJob[]
  periodJobs?: CleanerJob[]
  accounts?: Array<{
    id: string
    frequency: string
    daysOfWeek: string | null
    monthlyPattern: string | null
    startTime: string | null
    startWindowBegin: string | null
    startWindowEnd: string | null
    timeType: string | null
    defaultClientRate: number | null
    defaultSubcontractorRate: number | null
    startDate: string
    location: {
      id: string
      name: string
      address: string
      client: { id: string; name: string }
    }
  }>
}

export interface CleanerClientRow {
  clientId: string
  clientName: string
  payType: 'FLAT_RATE' | 'PER_CLEAN' | 'ONE_OFF'
  amount: number
  jobs: CleanerJob[]
}

export interface CleanerMonthGroup {
  monthKey: string
  label: string
  clients: CleanerClientRow[]
  total: number
  allJobIds: string[]
}
