import fs from 'fs'
import path from 'path'
import { PrismaClient, type Prisma } from '@prisma/client'
import { regenerateJobsForSchedule } from '../lib/regenerate-schedule-jobs'

type SourceRow = Record<string, string | number | null | undefined> & { row: number }
type ClientWithSourceDetails = Prisma.ClientGetPayload<{
  include: {
    locations: {
      include: {
        schedules: {
          include: {
            subcontractor: true
            recurringAddOnServices: true
          }
        }
      }
    }
  }
}>

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const REGENERATE = process.argv.includes('--regenerate')
const REPAIR_JOBS = process.argv.includes('--repair-jobs') || REGENERATE
const sourcePath =
  process.argv.find((arg) => arg.endsWith('.json')) ||
  process.env.SOURCE_TRUTH_JSON ||
  path.join(process.env.TEMP || '', 'cf-source-truth.json')

const DAY_MAP: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

function clean(value: unknown) {
  return String(value ?? '')
    .replace(/\u00e2\u20ac\u201c/g, '-')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function norm(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function numberValue(value: unknown) {
  const str = clean(value).replace(/[$,]/g, '')
  if (!str) return null
  const parsed = Number(str)
  return Number.isFinite(parsed) ? parsed : null
}

function extractEmails(value: unknown) {
  return clean(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
}

function uniqueEmails(values: unknown[]) {
  const seen = new Set<string>()
  const emails: string[] = []

  for (const value of values) {
    for (const email of extractEmails(value)) {
      const key = email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      emails.push(email)
    }
  }

  return emails
}

function excelDate(value: unknown) {
  const str = clean(value)
  if (!str) return null

  const serial = Number(str)
  if (Number.isFinite(serial)) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
  }

  const match = str.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (!match) return null

  let year = match[3] ? Number(match[3]) : 2026
  if (year < 100) year += 2000
  return new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2]), 12))
}

function ymd(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : null
}

function displayDateCell(value: unknown) {
  const raw = clean(value)
  if (!raw) return null
  const parsed = excelDate(value)
  return parsed && /^\d+(?:\.0)?$/.test(raw) ? ymd(parsed) : raw
}

function parsePayType(value: unknown) {
  const text = norm(value)
  return text.includes('monthly') || text.includes('flat') ? 'FLAT_RATE' : 'PER_CLEAN'
}

function parseClientAndLocation(sourceName: unknown) {
  const name = clean(sourceName)
  if (name.startsWith('A&B Development: Location 1')) {
    return {
      clientName: 'A&B Development',
      locationHint: 'Los Feliz',
      locationName: 'Los Feliz Building',
    }
  }
  if (name.startsWith('A&B Development: Location 2')) {
    return {
      clientName: 'A&B Development',
      locationHint: 'Hillhurst',
      locationName: 'Hillhurst Building',
    }
  }

  const dordick = name.match(/^Dordick Law Corporation \((.+)\)$/)
  if (dordick) {
    return {
      clientName: 'Dordick Law Corporation',
      locationHint: dordick[1],
      locationName:
        dordick[1] === 'DTLA'
          ? 'Dordick Law Corporation DTLA'
          : 'Dordick Law Corporation (Beverly Hills)',
    }
  }

  return { clientName: name, locationHint: '', locationName: name }
}

function parseFrequency(value: unknown) {
  const text = clean(value).toLowerCase()
  if (text.includes('every 3')) return 'EVERY_3_WEEKS'
  if (text.includes('bi-weekly') || text.includes('bi weekly')) return 'BI_WEEKLY'
  if (text.includes('2x monthly')) return '2X_MONTHLY'
  if (text.includes('1x monthly')) return 'MONTHLY'
  if (text.includes('as-needed') || text.includes('as needed')) return 'CUSTOM'
  return 'WEEKLY'
}

function parseDays(value: unknown) {
  const text = clean(value).toLowerCase()
  if (text.includes('mon-fri') || (text.includes('5x') && text.includes('mon') && text.includes('fri'))) {
    return [1, 2, 3, 4, 5]
  }
  if (text.includes('mon-sun') || text.includes('daily')) {
    return [0, 1, 2, 3, 4, 5, 6]
  }

  const days: number[] = []
  for (const [label, value] of Object.entries(DAY_MAP)) {
    if (new RegExp(`\\b${label}\\b`).test(text) && !days.includes(value)) {
      days.push(value)
    }
  }
  return days.sort((a, b) => a - b)
}

function timePart(part: string, fallbackSuffix?: string) {
  let text = clean(part).toLowerCase().replace(/\s+/g, '')
  if (!text) return null
  if (!/(am|pm)$/.test(text) && fallbackSuffix) text += fallbackSuffix

  const match = text.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
  if (!match) return null

  let hour = Number(match[1])
  const minutes = match[2] || '00'
  const ampm = match[3]
  if (ampm === 'pm' && hour !== 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  return `${String(hour).padStart(2, '0')}:${minutes}`
}

function parseTimeWindow(value: unknown) {
  const parts = clean(value).toLowerCase().split('-').map((part) => part.trim())
  if (parts.length < 2) return { begin: null as string | null, end: null as string | null }

  const suffixA = parts[0].match(/(am|pm)\s*$/)?.[1]
  const suffixB = parts[1].match(/(am|pm)\s*$/)?.[1]
  return {
    begin: timePart(parts[0], suffixB),
    end: timePart(parts[1], suffixA),
  }
}

function monthlyPattern(frequencyLabel: unknown) {
  const text = clean(frequencyLabel).toLowerCase()
  if (text.includes('1st') && text.includes('3rd')) {
    const days = parseDays(frequencyLabel)
    return JSON.stringify({ type: 'NTH_WEEKDAY', weekday: days[0] ?? 1, weeks: [1, 3] })
  }

  const fixedDates = [...text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 1 && value <= 31)

  if (text.includes('2x monthly') && fixedDates.length >= 2) {
    return JSON.stringify({ type: 'FIXED_DATES', dates: fixedDates.slice(0, 2) })
  }

  return null
}

function addOnFrequency(value: unknown) {
  const text = clean(value).toLowerCase()
  if (!text) return null
  if (text.includes('6')) return 'EVERY_6_WEEKS'
  if (text.includes('3')) return 'EVERY_3_WEEKS'
  if (text.includes('bi')) return 'BI_WEEKLY'
  if (text.includes('week')) return 'WEEKLY'
  return 'MONTHLY'
}

function sourceStartDate(row: SourceRow) {
  if (clean(row.Client).includes('All Schools World Language Catholic School')) {
    return new Date(Date.UTC(2026, 4, 11, 12))
  }
  return excelDate(row['Start Date'])
}

function cleanerAlias(value: unknown) {
  const text = clean(value)
  if (text.includes('Jessika')) return 'Ricardo (MCS Cleaning)'
  if (text === 'Rose Cleaning Co.') return 'Rose Cleaning Co'
  return text
}

function invoiceFields(row: SourceRow) {
  const mainName = clean(row['Main Point of Contact'])
  const mainEmail = clean(row['Main Point of Contact Email Address'])
  const mainPhone = clean(row['Main Point of Contact Phone Number'])
  const invoiceContact = clean(row['Invoice Contact'])
  const explicitInvoiceEmails = uniqueEmails([row['Invoice Contact Email']])
  const mainEmails = uniqueEmails([mainEmail])
  const invoiceEmail = explicitInvoiceEmails[0] || mainEmails[0] || null
  const ccEmails = explicitInvoiceEmails.slice(1)

  if (invoiceContact.toLowerCase().includes('cc additional')) {
    ccEmails.push(
      ...uniqueEmails([
        row['Additional Contact Email Address'],
        row['Additional Contact 2 Email Address'],
      ]).filter((email) => email.toLowerCase() !== invoiceEmail?.toLowerCase()),
    )
  }

  return {
    invoicingContactName:
      invoiceContact && !['main', '(same)', 'main + cc additional'].includes(invoiceContact.toLowerCase())
        ? invoiceContact
        : mainName || null,
    invoicingEmail: invoiceEmail,
    invoicingCcEmail: uniqueEmails(ccEmails).join(', ') || null,
    invoicingPhone: mainPhone || null,
  }
}

async function findClient(clientName: string) {
  if (!clientCache) {
    clientCache = await prisma.client.findMany({
      include: {
        locations: {
          include: {
            schedules: {
              include: {
                subcontractor: true,
                recurringAddOnServices: { where: { isRecurring: true }, orderBy: { createdAt: 'asc' } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    })
  }

  return clientCache.find((client) => norm(client.name) === norm(clientName)) || null
}

let clientCache: ClientWithSourceDetails[] | null = null

function findLocation(
  client: NonNullable<Awaited<ReturnType<typeof findClient>>>,
  row: SourceRow,
  hint: string,
) {
  const sourceAddress = norm(row['Facility Address'])
  if (client.locations.length === 1) return client.locations[0]

  return (
    client.locations.find((location) => {
      const address = norm(location.address)
      return sourceAddress && (sourceAddress.includes(address.slice(0, 20)) || address.includes(sourceAddress.slice(0, 20)))
    }) ||
    client.locations.find((location) => {
      const label = `${location.name} ${location.address}`
      return hint && norm(label).includes(norm(hint))
    }) ||
    client.locations[0] ||
    null
  )
}

function findSchedule(
  location: ReturnType<typeof findLocation>,
  row: SourceRow,
  usedScheduleIds: Set<string>,
) {
  if (!location) return null
  const targetClientRate = scheduleClientRate(row)
  const targetSubRate = numberValue(row['Cleaner Payout'])

  const activeSchedules = location.schedules.filter((schedule) => schedule.isActive !== false)
  const exact = activeSchedules.find(
    (schedule) =>
      !usedScheduleIds.has(schedule.id) &&
      Math.abs(schedule.defaultClientRate - (targetClientRate ?? -1)) < 0.01 &&
      Math.abs(schedule.defaultSubcontractorRate - (targetSubRate ?? -1)) < 0.01,
  )

  return exact || activeSchedules.find((schedule) => !usedScheduleIds.has(schedule.id)) || activeSchedules[0] || null
}

function scheduleClientRate(row: SourceRow) {
  const clientPayType = parsePayType(row['Pay Type - Client'])
  const clientPrice = numberValue(row['Client Price'])
  const revenue = numberValue(row.Revenue)
  const hasAddOn = Boolean(clean(row['Add-On #1']) || clean(row['Add-On #2']))

  if (clientPayType === 'FLAT_RATE' && !hasAddOn && revenue && clientPrice && revenue > clientPrice) {
    return revenue
  }

  return clientPrice
}

function scheduleSourceData(row: SourceRow) {
  const frequency = parseFrequency(row.Frequency)
  const days = parseDays(row.Frequency)
  const time = parseTimeWindow(row['Time Window'])
  const pattern = monthlyPattern(row.Frequency)
  const clientPayType = parsePayType(row['Pay Type - Client'])
  const subcontractorPayType = parsePayType(row['Pay Type to Cleaner'])
  const startDate = sourceStartDate(row)

  return {
    frequency,
    daysOfWeek: ['WEEKLY', 'BI_WEEKLY', 'EVERY_3_WEEKS', 'EVERY_4_WEEKS', 'EVERY_6_WEEKS'].includes(frequency)
      ? JSON.stringify(days)
      : days.length
        ? JSON.stringify(days)
        : null,
    monthlyPattern: pattern,
    customDates: null,
    timeType: 'WINDOW',
    startTime: null,
    startWindowBegin: time.begin,
    startWindowEnd: time.end,
    defaultClientRate: scheduleClientRate(row) ?? 0,
    defaultSubcontractorRate: numberValue(row['Cleaner Payout']) ?? 0,
    clientPayType,
    subcontractorPayType,
    startDate: startDate ?? new Date(),
    endDate: excelDate(row['End Date?']),
    isActive: true,
  }
}

function scheduleData(row: SourceRow, subcontractorId: string | null): Prisma.ScheduleUpdateInput {
  return {
    ...scheduleSourceData(row),
    subcontractor: subcontractorId ? { connect: { id: subcontractorId } } : { disconnect: true },
  }
}

function scheduleCreateData(
  row: SourceRow,
  locationId: string,
  subcontractorId: string | null,
): Prisma.ScheduleUncheckedCreateInput {
  return {
    locationId,
    subcontractorId,
    ...scheduleSourceData(row),
  }
}

function clientData(row: SourceRow, subcontractorId: string | null): Prisma.ClientUpdateInput {
  const startDate = sourceStartDate(row)
  const invoice = invoiceFields(row)
  return {
    phone: clean(row['Main Point of Contact Phone Number']) || null,
    communicationContactName: clean(row['Main Point of Contact']) || null,
    communicationEmail: clean(row['Main Point of Contact Email Address']) || null,
    communicationPhone: clean(row['Main Point of Contact Phone Number']) || null,
    ...invoice,
    notes: clean(row.Notes) || null,
    billingType: parsePayType(row['Pay Type - Client']),
    cleanerPayType: parsePayType(row['Pay Type to Cleaner']),
    preferredPaymentMethod: clean(row['Payment Method']) || null,
    startDate,
    clientPrice: numberValue(row['Client Price']),
    revenue: numberValue(row.Revenue),
    cleanerPayout: numberValue(row['Cleaner Payout']),
    frequency: clean(row.Frequency) || null,
    recurring: numberValue(row['# Recurring']),
    addon1Name: clean(row['Add-On #1']) || null,
    addon1ClientPrice: numberValue(row['Add-On #1 Client Price']),
    addon1Frequency: clean(row['Add-On #1 Frequency']) || null,
    addon1CleanerPayout: numberValue(row['Add-On #1 Cleaner Payout']),
    addon2Name: clean(row['Add-On #2']) || null,
    addon2ClientPrice: numberValue(row['Add-On #2 Client Price']),
    addon2Frequency: clean(row['Add-On #2 Frequency']) || null,
    addon2CleanerPayout: numberValue(row['Add-On #2 Cleaner Payout']),
    cleanerAssigned: subcontractorId ? { connect: { id: subcontractorId } } : { disconnect: true },
  }
}

async function findOrCreateSubcontractor(name: string) {
  if (!name) return null
  if (!subcontractorCache) subcontractorCache = await prisma.subcontractor.findMany()

  const hit = subcontractorCache.find((sub) => norm(sub.name) === norm(name) || norm(sub.name).startsWith(norm(name)))
  if (hit) return hit

  if (!APPLY) return { id: `DRY-RUN-${name}`, name }
  const created = await prisma.subcontractor.create({ data: { name, isActive: true } })
  subcontractorCache.push(created)
  return created
}

let subcontractorCache: Awaited<ReturnType<typeof prisma.subcontractor.findMany>> | null = null

async function upsertContact(clientId: string, name: string, role: string, email?: string, phone?: string, notes?: string) {
  if (!name && !email && !phone) return
  const existing = await prisma.clientContact.findFirst({
    where: {
      clientId,
      OR: [{ email: email || undefined }, { name: name || undefined }],
    },
  })

  const data = {
    name: name || email || 'Contact',
    email: email || null,
    phone: phone || null,
    role,
    notes: notes || null,
    isPrimary: role !== 'GENERAL',
  }

  if (!APPLY) return
  if (existing) {
    await prisma.clientContact.update({ where: { id: existing.id }, data })
  } else {
    await prisma.clientContact.create({ data: { clientId, ...data } })
  }
}

async function syncAddOns(scheduleId: string, row: SourceRow) {
  const addOns = [1, 2]
    .map((index) => ({
      description: clean(row[`Add-On #${index}`]),
      clientRate: numberValue(row[`Add-On #${index} Client Price`]) ?? 0,
      frequency: addOnFrequency(row[`Add-On #${index} Frequency`]),
      subcontractorRate: numberValue(row[`Add-On #${index} Cleaner Payout`]) ?? 0,
    }))
    .filter((addOn) => addOn.description)

  if (!APPLY) return

  const existing = await prisma.addOnService.findMany({
    where: { scheduleId, isRecurring: true },
    include: {
      _count: {
        select: {
          invoiceLineItems: true,
          vendorPaymentLineItems: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const keptIds = new Set<string>()

  for (const [index, addOn] of addOns.entries()) {
    const match =
      existing.find((item) => norm(item.description) === norm(addOn.description)) ||
      existing[index]

    if (match) {
      keptIds.add(match.id)
      await prisma.addOnService.update({
        where: { id: match.id },
        data: {
          description: addOn.description,
          clientRate: addOn.clientRate,
          subcontractorRate: addOn.subcontractorRate,
          frequency: addOn.frequency,
          isRecurring: true,
        },
      })
    } else {
      await prisma.addOnService.create({
        data: {
          scheduleId,
          description: addOn.description,
          clientRate: addOn.clientRate,
          subcontractorRate: addOn.subcontractorRate,
          frequency: addOn.frequency,
          isRecurring: true,
        },
      })
    }
  }

  const expectedDescriptions = new Set(addOns.map((addOn) => norm(addOn.description)))
  for (const item of existing) {
    if (keptIds.has(item.id) || expectedDescriptions.has(norm(item.description))) continue

    if (item._count.invoiceLineItems === 0 && item._count.vendorPaymentLineItems === 0) {
      await prisma.addOnService.delete({ where: { id: item.id } })
    } else {
      await prisma.addOnService.update({
        where: { id: item.id },
        data: {
          isRecurring: false,
          scheduleId: null,
        },
      })
    }
  }
}

async function repairEditableJobsFromSchedule(scheduleId: string, row: SourceRow, subcontractorId: string | null) {
  if (!APPLY) return 0

  const time = parseTimeWindow(row['Time Window'])
  const repaired = await prisma.job.updateMany({
    where: {
      scheduleId,
      status: { not: 'CANCELLED' },
      subcontractorPaid: false,
      invoiceLineItems: {
        none: {
          invoice: {
            status: { in: ['SENT', 'PAID'] },
          },
        },
      },
    },
    data: {
      subcontractorId,
      clientRate: scheduleClientRate(row) ?? 0,
      subcontractorRate: numberValue(row['Cleaner Payout']) ?? 0,
      startTime: null,
      startWindowBegin: time.begin,
      startWindowEnd: time.end,
    },
  })

  return repaired.count
}

async function syncRow(row: SourceRow, usedScheduleIds: Set<string>) {
  const { clientName, locationHint, locationName } = parseClientAndLocation(row.Client)
  const client = await findClient(clientName)
  if (!client) return { status: 'missing', row: row.row, clientName }

  const subcontractor = await findOrCreateSubcontractor(cleanerAlias(row['Cleaner Assigned']))
  const subcontractorId = subcontractor?.id.startsWith('DRY-RUN-') ? null : subcontractor?.id ?? null
  const location = findLocation(client, row, locationHint)
  let schedule = findSchedule(location, row, usedScheduleIds)

  if (schedule) usedScheduleIds.add(schedule.id)

  const changes = {
    client: client.name,
    source: row.Client,
    location: location?.name ?? null,
    schedule: schedule?.id ?? null,
    cleaner: subcontractor?.name ?? null,
  }

  if (!APPLY) return { status: 'would-sync', row: row.row, ...changes }

  const updatedClient = await prisma.client.update({
    where: { id: client.id },
    data: clientData(row, subcontractorId),
  })

  const savedLocation = location
    ? await prisma.location.update({
        where: { id: location.id },
        data: {
          name: locationName,
          address: clean(row['Facility Address']),
        },
      })
    : await prisma.location.create({
        data: {
          clientId: updatedClient.id,
          name: locationName,
          address: clean(row['Facility Address']),
        },
      })

  if (schedule) {
    schedule = await prisma.schedule.update({
      where: { id: schedule.id },
      data: scheduleData(row, subcontractorId),
      include: {
        subcontractor: true,
        recurringAddOnServices: true,
      },
    })
  } else {
    schedule = await prisma.schedule.create({
      data: scheduleCreateData(row, savedLocation.id, subcontractorId),
      include: {
        subcontractor: true,
        recurringAddOnServices: true,
      },
    })
  }

  await syncAddOns(schedule.id, row)
  const repairedJobs = REPAIR_JOBS
    ? await repairEditableJobsFromSchedule(schedule.id, row, subcontractorId)
    : 0

  await upsertContact(
    updatedClient.id,
    clean(row['Main Point of Contact']),
    'COMMUNICATION',
    clean(row['Main Point of Contact Email Address']),
    clean(row['Main Point of Contact Phone Number']),
  )
  await upsertContact(
    updatedClient.id,
    clean(row['Additional Contact']),
    'GENERAL',
    clean(row['Additional Contact Email Address']),
    clean(row['Additional Contact Phone Number']),
    clean(row['Additional Contact Description']),
  )
  await upsertContact(
    updatedClient.id,
    clean(row['Additional Contact 2']),
    'GENERAL',
    clean(row['Additional Contact 2 Email Address']),
    undefined,
    clean(row['Additional Contact 2 Description']),
  )

  if (REGENERATE) {
    await regenerateJobsForSchedule(schedule.id, {
      effectiveDate: sourceStartDate(row) ?? new Date(),
    })
  }

  return { status: 'synced', row: row.row, ...changes, schedule: schedule.id, repairedJobs }
}

async function deactivateAsNeededSchedules(rows: SourceRow[]) {
  const asNeededRows = rows.filter((row) => clean(row.Frequency).toLowerCase().includes('as-needed'))
  const result: Array<Record<string, unknown>> = []

  for (const row of asNeededRows) {
    const { clientName } = parseClientAndLocation(row.Client)
    const client = await findClient(clientName)
    if (!client) continue

    const schedules = client.locations.flatMap((location) => location.schedules)
    result.push({ client: client.name, schedules: schedules.length })
    if (APPLY) {
      await prisma.schedule.updateMany({
        where: { location: { clientId: client.id } },
        data: { isActive: false },
      })
    }
  }

  return result
}

function summarizeNonRecurringRows(rows: SourceRow[]) {
  return rows
    .filter((row) => {
      const client = clean(row.Client).toLowerCase()
      return (
        client &&
        !['non-recurring', 'canceled: past cleans that need to be tracked', "trial, didn't close them:"].includes(client)
      )
    })
    .map((row) => {
      const client = clean(row.Client)
      const startDate = displayDateCell(row['Start Date'])
      const endDate = displayDateCell(row['End Date?'])
      const trialDate = displayDateCell(row['Trial Date (if applicable)'])
      const cleaner = cleanerAlias(row['Cleaner Assigned'])
      const clientPrice = clean(row['Client Price'])
      const cleanerPayout = clean(row['Cleaner Payout'])
      const frequency = clean(row.Frequency)
      const status = clean(row['Paid Invoice? (April)'])

      const questions: string[] = []
      if (!cleaner) questions.push('missing cleaner')
      if (!startDate && !trialDate) questions.push('missing service date(s)')
      if (!clientPrice) questions.push('missing client price')
      if (!cleanerPayout) questions.push('missing cleaner payout')
      if (!clean(row['Facility Address'])) questions.push('missing facility address')

      return {
        row: row.row,
        client,
        category:
          row.row >= 45
            ? 'trial-not-closed'
            : row.row >= 39
              ? 'canceled-history'
              : 'non-recurring',
        status: status || null,
        cleaner: cleaner || null,
        dates: trialDate || startDate || null,
        endDate: endDate || null,
        frequency: frequency || null,
        clientPrice: clientPrice || null,
        cleanerPayout: cleanerPayout || null,
        recommendation:
          questions.length > 0
            ? `needs confirmation: ${questions.join(', ')}`
            : 'safe to import after confirming whether this should affect calendar only, cleaner pay, invoices, or all three',
      }
    })
}

async function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source JSON not found: ${sourcePath}`)
  }

  const rows = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '')) as SourceRow[]
  const activeRows = rows.filter((row) => row.row >= 2 && row.row <= 31)
  const nonRecurringRows = rows.filter((row) => row.row >= 34 && row.row <= 46)
  const usedScheduleIds = new Set<string>()
  const results = []

  console.log(`${APPLY ? 'Applying' : 'Dry run'} source-of-truth sync from ${sourcePath}`)
  for (const row of activeRows) {
    results.push(await syncRow(row, usedScheduleIds))
  }

  const deactivated = await deactivateAsNeededSchedules(nonRecurringRows)
  const historicalRowsNeedingConfirmation = summarizeNonRecurringRows(nonRecurringRows)

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'applied' : 'dry-run',
        regenerated: APPLY && REGENERATE,
        repairedJobs: APPLY && REPAIR_JOBS,
        activeRows: activeRows.length,
        results,
        asNeededSchedules: deactivated,
        historicalRowsNeedingConfirmation,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
