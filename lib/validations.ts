import { z } from 'zod'

/**
 * Zod validation schemas for API routes
 * Ensures data integrity and prevents invalid data from reaching the database
 */

// Client schemas
export const createClientSchema = z.object({
  name: z.string().min(1, 'Client name is required').max(200),
  phone: z.string().max(50, 'Phone number too long').optional().nullable(),
  communicationEmail: z.string().email('Invalid email format').optional().nullable().or(z.literal('')),
  communicationContactName: z.string().max(200).optional().nullable().or(z.literal('')),
  communicationPhone: z.string().max(50, 'Phone number too long').optional().nullable().or(z.literal('')),
  invoicingEmail: z.string().email('Invalid email format').optional().nullable().or(z.literal('')),
  invoicingCcEmail: z.string().max(1000, 'Invoice CC email(s) too long').optional().nullable().or(z.literal('')),
  invoicingContactName: z.string().max(200).optional().nullable().or(z.literal('')),
  invoicingPhone: z.string().max(50, 'Phone number too long').optional().nullable().or(z.literal('')),
  billingType: z.enum(['FLAT_RATE', 'PER_CLEAN'], {
    errorMap: () => ({ message: 'Billing type must be FLAT_RATE or PER_CLEAN' }),
  }),
  cleanerPayType: z.enum(['FLAT_RATE', 'PER_CLEAN'], {
    errorMap: () => ({ message: 'Cleaner pay type must be FLAT_RATE or PER_CLEAN' }),
  }).optional().default('PER_CLEAN'),
  invoiceFrequency: z.enum(['AFTER_EACH_CLEAN', 'BI_WEEKLY', 'END_OF_MONTH', 'CUSTOM'], {
    errorMap: () => ({ message: 'Invoice frequency must be AFTER_EACH_CLEAN, BI_WEEKLY, END_OF_MONTH, or CUSTOM' }),
  }).optional().default('END_OF_MONTH'),
  preferredPaymentMethod: z.enum(['ZELLE', 'DIRECT_DEPOSIT', 'CHECK', 'OTHER'], {
    errorMap: () => ({ message: 'Payment method must be ZELLE, DIRECT_DEPOSIT, CHECK, or OTHER' }),
  }).optional().nullable().or(z.literal('').transform(() => null)),
  startDate: z.string().or(z.date()).optional().nullable(), // When the client relationship started
  notes: z.string().max(5000, 'Notes too long').optional().nullable(),
  isActive: z.boolean().optional(),
  openIssues: z.array(z.string().max(500, 'Issue too long')).optional(),
  scopeNotes: z.string().max(5000, 'Scope notes too long').optional().nullable(),
  scopeDocUrl: z.string().max(2000, 'Link too long').optional().nullable(),
  sourceProspectId: z.string().uuid('Invalid prospect ID').optional().nullable(),
  locations: z.array(z.object({
    name: z.string().min(1, 'Location name is required').max(200, 'Location name too long'),
    address: z.string().min(1, 'Address is required').max(500, 'Address too long'),
  })).optional(),
})

export const updateClientSchema = createClientSchema.partial().extend({
  name: z.string().min(1, 'Client name is required').max(200).optional(),
})

// Location schemas
export const createLocationSchema = z.object({
  clientId: z.string().uuid('Invalid client ID'),
  name: z.string().min(1, 'Location name is required').max(200),
  address: z.string().min(1, 'Address is required').max(500, 'Address too long'),
  accessInfo: z.string().max(2000, 'Access info too long').optional().nullable(), // Gate codes, key locations, entry instructions
})

export const updateLocationSchema = createLocationSchema.omit({ clientId: true }).partial()

// Monthly pattern schemas for 2x monthly scheduling
export const fixedDatesPatternSchema = z.object({
  type: z.literal('FIXED_DATES'),
  dates: z.array(z.number().min(1).max(31)).min(1, 'Must select at least 1 date').max(2, 'Must select no more than 2 dates'),
})

export const nthWeekdayPatternSchema = z.object({
  type: z.literal('NTH_WEEKDAY'),
  weekday: z.number().min(0).max(6), // 0 = Sunday, 6 = Saturday
  weeks: z.array(z.union([z.number().min(1).max(4), z.literal('last')])).min(1, 'Must select at least one week'),
})

export const monthlyPatternSchema = z.union([fixedDatesPatternSchema, nthWeekdayPatternSchema])

// Schedule schemas
export const createScheduleSchema = z.object({
  locationId: z.string().uuid('Invalid location ID'),
  frequency: z.enum(['WEEKLY', 'BI_WEEKLY', 'EVERY_3_WEEKS', 'EVERY_4_WEEKS', 'EVERY_6_WEEKS', 'MONTHLY', '2X_MONTHLY', 'CUSTOM']),
  daysOfWeek: z.string().optional().nullable(), // JSON string of array - optional for 2X_MONTHLY
  monthlyPattern: z.string().optional().nullable(), // JSON string of pattern config for 2X_MONTHLY
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()).optional().nullable(),
  defaultClientRate: z.number().min(0, 'Client rate must be positive'),
  defaultSubcontractorRate: z.number().min(0, 'Subcontractor rate must be positive'),
  clientPayType: z.enum(['FLAT_RATE', 'PER_CLEAN'], {
    errorMap: () => ({ message: 'Client pay type must be FLAT_RATE or PER_CLEAN' }),
  }),
  subcontractorPayType: z.enum(['FLAT_RATE', 'PER_CLEAN'], {
    errorMap: () => ({ message: 'Subcontractor pay type must be FLAT_RATE or PER_CLEAN' }),
  }),
  subcontractorId: z.string().uuid('Invalid subcontractor ID').optional().nullable(),
  timeType: z.enum(['SPECIFIC', 'WINDOW']),
  startTime: z.string().optional().nullable(),
  startWindowBegin: z.string().optional().nullable(),
  startWindowEnd: z.string().optional().nullable(),
})

export const updateScheduleSchema = createScheduleSchema.partial()

export const changeScheduleGoingForwardSchema = createScheduleSchema.extend({
  carryForwardRecurringAddOns: z.boolean().optional().default(true),
})

// Job schemas
export const createJobSchema = z.object({
  locationId: z.string().uuid('Invalid location ID'),
  subcontractorId: z.string().uuid('Invalid subcontractor ID').optional().nullable(),
  scheduleId: z.string().uuid('Invalid schedule ID').optional().nullable(), // For one-time jobs linked to a schedule
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  startTime: z.string().optional().nullable(),
  startWindowBegin: z.string().optional().nullable(),
  startWindowEnd: z.string().optional().nullable(),
  clientRate: z.number().min(0, 'Client rate must be positive'),
  subcontractorRate: z.number().min(0, 'Subcontractor rate must be positive'),
  notes: z.string().max(5000, 'Notes too long').optional().nullable(),
  isTrial: z.boolean().optional().default(false),
  trialNotes: z.string().max(5000, 'Trial notes too long').optional().nullable(),
})

export const updateJobSchema = z.object({
  locationId: z.string().uuid('Invalid location ID').optional(),
  subcontractorId: z.string().uuid('Invalid subcontractor ID').optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  startTime: z.string().optional().nullable(),
  startWindowBegin: z.string().optional().nullable(),
  startWindowEnd: z.string().optional().nullable(),
  clientRate: z.number().min(0, 'Client rate must be positive').optional(),
  subcontractorRate: z.number().min(0, 'Subcontractor rate must be positive').optional(),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  subcontractorPaid: z.boolean().optional(),
  notes: z.string().max(5000, 'Notes too long').optional().nullable(),
  isTrial: z.boolean().optional(),
  trialNotes: z.string().max(5000, 'Trial notes too long').optional().nullable(),
})

// Invoice schemas
export const createInvoiceSchema = z.object({
  clientId: z.string().uuid('Invalid client ID'),
  jobIds: z.array(z.string().uuid('Invalid job ID')).min(1, 'At least one job is required'),
  dateDue: z.string().optional().nullable(),
  notes: z.string().max(5000, 'Notes too long').optional().nullable(),
  showPaymentOptions: z.boolean().optional(),
  status: z.enum(['DRAFT', 'SENT', 'PAID']).optional(),
})

export const updateInvoiceSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PAID']).optional(),
  showPaymentOptions: z.boolean().optional(),
})

// Subcontractor schemas
export const createSubcontractorSchema = z.object({
  name: z.string().min(1, 'Subcontractor name is required').max(200),
  phone: z.string().max(50, 'Phone number too long').optional().nullable(),
  email: z.string().email('Invalid email format').optional().nullable().or(z.literal('')),
  notes: z.string().max(5000, 'Notes cannot exceed 5000 characters').optional().nullable(),
})

// Expense schemas
const expenseCategoryEnum = z.enum([
  'RENT', 'INSURANCE', 'SOFTWARE_SUBSCRIPTIONS', 'OFFICE_SUPPLIES', 
  'UTILITIES', 'PHONE_INTERNET', 'PROFESSIONAL_FEES',
  'SUBCONTRACTOR_PAYMENTS', 'CLEANING_SUPPLIES', 'EQUIPMENT', 
  'VEHICLE_FUEL', 'VEHICLE_MAINTENANCE', 'MARKETING_ADVERTISING', 
  'TRAVEL', 'MEALS_ENTERTAINMENT', 'OTHER'
], {
  errorMap: () => ({ message: 'Invalid expense category' }),
})

const expenseTypeEnum = z.enum(['FIXED', 'VARIABLE'], {
  errorMap: () => ({ message: 'Type must be FIXED or VARIABLE' }),
})

export const createExpenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  amount: z.union([
    z.number().min(0.01, 'Amount must be greater than 0').max(1000000, 'Amount too large'),
    z.string().transform((val) => {
      const parsed = parseFloat(val)
      if (isNaN(parsed)) throw new Error('Invalid amount')
      return parsed
    }).pipe(z.number().min(0.01, 'Amount must be greater than 0').max(1000000, 'Amount too large'))
  ]),
  description: z.string().min(1, 'Description is required').max(500, 'Description too long'),
  category: expenseCategoryEnum.optional().nullable(),
  type: expenseTypeEnum.optional().nullable(),
  vendor: z.string().max(200, 'Vendor name too long').optional().nullable(),
  notes: z.string().max(2000, 'Notes too long').optional().nullable(),
  isRecurring: z.boolean().optional().default(false),
})

export const updateExpenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  amount: z.number().min(0.01, 'Amount must be greater than 0').max(1000000, 'Amount too large').optional(),
  description: z.string().min(1, 'Description is required').max(500, 'Description too long').optional(),
  category: expenseCategoryEnum.optional().nullable(),
  type: expenseTypeEnum.optional().nullable(),
  vendor: z.string().max(200, 'Vendor name too long').optional().nullable(),
  notes: z.string().max(2000, 'Notes too long').optional().nullable(),
  isRecurring: z.boolean().optional(),
})

// Payment schemas
export const createPaymentSchema = z.object({
  jobIds: z.array(z.string().uuid('Invalid job ID')).min(1, 'At least one job is required'),
  datePaid: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  notes: z.string().max(2000, 'Notes too long').optional().nullable(),
})

// Email Invoice Schema
export const emailInvoiceSchema = z.object({
  to: z.union([
    z.string().email('Invalid email address'),
    z.array(z.string().email('Invalid email address')).min(1, 'At least one recipient is required')
  ]),
  subject: z.string().min(1, 'Subject is required').max(200, 'Subject too long'),
  message: z.string().min(1, 'Message is required').max(10000, 'Message too long'),
  cc: z.union([
    z.string().max(1000, 'CC email list is too long'),
    z.array(z.string().email('Invalid CC email address')),
    z.literal('')
  ]).optional(),
  isTest: z.boolean().default(false),
  showPaymentOptions: z.boolean().optional(),
})

// Square Payment Schema
export const squarePaymentSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID'),
  amount: z.number().min(0.01, 'Amount must be greater than 0').max(1000000, 'Amount too large'),
  sourceId: z.string().optional(), // Payment token from Web Payments SDK
  cardData: z.object({
    cardNumber: z.string().min(13, 'Invalid card number').max(19),
    expiryDate: z.string().regex(/^\d{2}\/\d{2}$/, 'Expiry must be MM/YY format'),
    cvv: z.string().min(3, 'CVV must be 3-4 digits').max(4),
    zipCode: z.string().min(5, 'Invalid zip code'),
    cardholderName: z.string().min(1, 'Cardholder name required'),
  }).optional(), // For sandbox testing with direct card data
})

// Mark Invoice Paid Schema
export const markInvoicePaidSchema = z.object({
  paymentMethod: z.enum(['ZELLE', 'VENMO', 'CHECK', 'CASH', 'SQUARE', 'MANUAL', 'OTHER'], {
    errorMap: () => ({ message: 'Invalid payment method' }),
  }).optional().default('MANUAL'),
  paymentNotes: z.string().max(2000, 'Notes too long').optional().nullable(),
})

// Login Rate Limiting Schema (for tracking attempts)
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const updateBusinessSettingsSchema = z.object({
  businessName: z.string().min(1, 'Business name is required').max(200).optional(),
  email: z.string().email('Invalid email').max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  defaultPaymentTerms: z.enum(['DUE_ON_RECEIPT', 'NET_15', 'NET_30', 'NET_45', 'NET_60']).optional(),
  autoGenerateInvoices: z.boolean().optional(),
  billingStartDate: z.string().nullable().optional(),
})

// Prospect schemas
const prospectStageSchema = z.enum([
  'NEW',
  'WALKTHROUGH_SCHEDULED',
  'WALKTHROUGH_DONE',
  'PROPOSAL_SENT',
  'FOLLOW_UP',
  'NEGOTIATION',
  'WON',
  'LOST',
])

const prospectStatusSchema = z.enum(['ACTIVE', 'WON', 'LOST'])

const nextActionTypeSchema = z.enum(['CALL', 'EMAIL', 'TEXT', 'CHECK_IN', 'WAIT'])

const prospectActivityEventTypeSchema = z.enum([
  'WALKTHROUGH_COMPLETED',
  'PROPOSAL_SENT',
  'FOLLOW_UP_ATTEMPT',
  'RESCHEDULED',
  'NOTE',
  'STATUS_CHANGE',
])

const prospectActivityChannelSchema = z.enum(['EMAIL', 'PHONE', 'TEXT', 'IN_PERSON'])

const optionalDateSchema = z.string().or(z.date()).optional().nullable()

export const createProspectSchema = z.object({
  businessName: z.string().min(1, 'Business name is required').max(200, 'Business name too long'),
  contactName: z.string().max(200, 'Contact name too long').optional().nullable().or(z.literal('')),
  phone: z.string().max(50, 'Phone number too long').optional().nullable().or(z.literal('')),
  email: z.string().email('Invalid email format').optional().nullable().or(z.literal('')),
  notes: z.string().max(5000, 'Notes too long').optional().nullable().or(z.literal('')),
  stage: prospectStageSchema.optional().default('NEW'),
  status: prospectStatusSchema.optional().default('ACTIVE'),
  nextActionType: nextActionTypeSchema.optional().nullable(),
  nextActionDueAt: optionalDateSchema,
  nextActionNote: z.string().max(1000, 'Next action note too long').optional().nullable().or(z.literal('')),
  proposalSentAt: optionalDateSchema,
  walkthroughAt: optionalDateSchema,
  source: z.string().max(200, 'Source is too long').optional().nullable().or(z.literal('')),
  priority: z.string().max(100, 'Priority is too long').optional().nullable().or(z.literal('')),
  lostReason: z.string().max(500, 'Lost reason too long').optional().nullable().or(z.literal('')),
  followUpDate: optionalDateSchema,
}).superRefine((value, ctx) => {
  const resolvedStage = value.stage ?? 'NEW'
  const resolvedStatus = value.status ?? (resolvedStage === 'WON' ? 'WON' : resolvedStage === 'LOST' ? 'LOST' : 'ACTIVE')
  const isClosed = resolvedStage === 'WON' || resolvedStage === 'LOST' || resolvedStatus === 'WON' || resolvedStatus === 'LOST'
  const nextActionDueAt = value.nextActionDueAt ?? value.followUpDate ?? null

  if (!isClosed && !nextActionDueAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextActionDueAt'],
      message: 'Active prospects must have a next action date',
    })
  }

  if (!isClosed && !value.nextActionType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextActionType'],
      message: 'Active prospects must have a next action type',
    })
  }

  if ((resolvedStage === 'WON' || resolvedStatus === 'WON') && resolvedStatus !== 'WON') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'Won prospects must use WON status',
    })
  }

  if ((resolvedStage === 'LOST' || resolvedStatus === 'LOST') && resolvedStatus !== 'LOST') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'Lost prospects must use LOST status',
    })
  }
})

export const updateProspectSchema = z.object({
  businessName: z.string().min(1, 'Business name is required').max(200).optional(),
  contactName: z.string().max(200, 'Contact name too long').optional().nullable().or(z.literal('')),
  phone: z.string().max(50, 'Phone number too long').optional().nullable().or(z.literal('')),
  email: z.string().email('Invalid email format').optional().nullable().or(z.literal('')),
  notes: z.string().max(5000, 'Notes too long').optional().nullable().or(z.literal('')),
  stage: prospectStageSchema.optional(),
  status: prospectStatusSchema.optional(),
  nextActionType: nextActionTypeSchema.optional().nullable(),
  nextActionDueAt: optionalDateSchema,
  nextActionNote: z.string().max(1000, 'Next action note too long').optional().nullable().or(z.literal('')),
  proposalSentAt: optionalDateSchema,
  walkthroughAt: optionalDateSchema,
  source: z.string().max(200, 'Source is too long').optional().nullable().or(z.literal('')),
  priority: z.string().max(100, 'Priority is too long').optional().nullable().or(z.literal('')),
  lostReason: z.string().max(500, 'Lost reason too long').optional().nullable().or(z.literal('')),
  followUpDate: optionalDateSchema,
})

export const createProspectActivitySchema = z.object({
  eventType: prospectActivityEventTypeSchema,
  channels: z.array(prospectActivityChannelSchema).optional().default([]),
  result: z.string().max(500, 'Result is too long').optional().nullable().or(z.literal('')),
  note: z.string().max(2000, 'Note too long').optional().nullable().or(z.literal('')),
  happenedAt: optionalDateSchema,
  stage: prospectStageSchema.optional(),
  status: prospectStatusSchema.optional(),
  nextActionType: nextActionTypeSchema.optional().nullable(),
  nextActionDueAt: optionalDateSchema,
  nextActionNote: z.string().max(1000, 'Next action note too long').optional().nullable().or(z.literal('')),
}).superRefine((value, ctx) => {
  const requiresChannel = value.eventType === 'FOLLOW_UP_ATTEMPT' || value.eventType === 'PROPOSAL_SENT'
  const stage = value.stage ?? 'FOLLOW_UP'
  const status = value.status ?? (stage === 'WON' ? 'WON' : stage === 'LOST' ? 'LOST' : 'ACTIVE')
  const isClosed = stage === 'WON' || stage === 'LOST' || status === 'WON' || status === 'LOST'

  if (requiresChannel && !value.channels?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['channels'],
      message: 'Choose at least one follow-up medium',
    })
  }

  if (!isClosed && !value.nextActionDueAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextActionDueAt'],
      message: 'Set the next action date before saving an active prospect touch',
    })
  }

  if (!isClosed && !value.nextActionType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextActionType'],
      message: 'Set the next action type before saving an active prospect touch',
    })
  }

  if (value.eventType === 'FOLLOW_UP_ATTEMPT' && !value.result?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['result'],
      message: 'Describe what happened before saving the follow-up',
    })
  }

  if (value.eventType === 'RESCHEDULED' && !value.result?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['result'],
      message: 'Choose a reschedule reason before saving',
    })
  }
})

export const markProspectWonSchema = z.object({
  mode: z.enum(['MARK_WON_ONLY', 'CREATE_CLIENT_NOW']),
})

const prospectImportPreviewRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  businessName: z.string(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  source: z.string().nullable(),
  priority: z.string().nullable(),
  stage: prospectStageSchema,
  status: prospectStatusSchema,
  nextActionType: nextActionTypeSchema.nullable(),
  nextActionDueAt: z.string().nullable(),
  nextActionNote: z.string().nullable(),
  proposalSentAt: z.string().nullable(),
  walkthroughAt: z.string().nullable(),
  lostReason: z.string().nullable(),
  warnings: z.array(z.string()),
  issues: z.array(z.string()),
})

export const prospectImportColumnMappingSchema = z
  .object({
    businessName: z.string().nullable().optional(),
    contactName: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    priority: z.string().nullable().optional(),
    stage: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    nextActionType: z.string().nullable().optional(),
    nextActionDueAt: z.string().nullable().optional(),
    nextActionNote: z.string().nullable().optional(),
    proposalSentAt: z.string().nullable().optional(),
    walkthroughAt: z.string().nullable().optional(),
    lostReason: z.string().nullable().optional(),
  })
  .partial()

export const previewProspectImportSchema = z.object({
  rows: z.array(prospectImportPreviewRowSchema).min(1, 'At least one row is required'),
})

// Helper function to format Zod errors for user display
export function formatZodErrors(error: z.ZodError): string[] {
  return error.errors.map(err => {
    const path = err.path.length > 0 ? `${err.path.join('.')}: ` : ''
    return `${path}${err.message}`
  })
}
