import { format } from "date-fns"

export interface PayLedgerGroup {
  clientId: string
  clientName: string
  payType: 'FLAT_RATE' | 'PER_CLEAN'
  jobs: any[]
  monthlyAmount?: number
  /** Total amount across all jobs (paid + unpaid) */
  totalAmount: number
  /** Amount still owed (unpaid only) — this is what the UI should display prominently */
  owedAmount: number
  paidCount: number
  unpaidCount: number
  month?: string
}

export interface PayLedgerResult {
  totalOwed: number
  groups: PayLedgerGroup[]
}

/**
 * Centralized helper to calculate the total owed amount to a subcontractor
 * and build the corresponding frontend ledger display groups.
 * Ensures queue, profile, and dashboard always agree.
 *
 * IMPORTANT: Every group exposes both `totalAmount` (all jobs) and `owedAmount`
 * (unpaid only). The UI header and group rows should both display `owedAmount`
 * so the numbers always sum correctly.
 */
export function buildSubcontractorPayLedger(jobs: any[]): PayLedgerResult {
  const jobsByClient = new Map<string, any[]>()

  // Group jobs safely by scheduleId/month or one-off
  jobs.forEach(job => {
    if (!job.location?.client) return
    const clientId = job.location.client.id
    const monthKey = format(new Date(job.date), 'yyyy-MM')
    const key = job.scheduleId
      ? `${clientId}:${job.scheduleId}:${monthKey}`
      : `${clientId}:${job.location.id}:one-off:${job.id}`

    if (!jobsByClient.has(key)) jobsByClient.set(key, [])
    jobsByClient.get(key)!.push(job)
  })

  let totalOwed = 0
  const groups: PayLedgerGroup[] = []

  jobsByClient.forEach((groupJobs, key) => {
    if (groupJobs.length === 0) return

    const firstJob = groupJobs[0]
    const client = firstJob.location.client
    const schedule = firstJob.schedule
    const isRecurring = firstJob.scheduleId !== null
    
    // Core fallback logic
    let payType = 'PER_CLEAN'
    if (schedule?.subcontractorPayType) {
      payType = schedule.subcontractorPayType
    } else if (client?.cleanerPayType) {
      payType = client.cleanerPayType
    }

    const locationName = firstJob.location.name
    const clientDisplayName = locationName ? `${client.name} — ${locationName}` : client.name
    const paidCount = groupJobs.filter((j: any) => j.subcontractorPaid).length
    const unpaidCount = groupJobs.filter((j: any) => !j.subcontractorPaid).length

    if (payType === 'FLAT_RATE' && isRecurring) {
      // Historical Accuracy Rule:
      // If there are paid jobs in this group, use the job's snapshot rate to avoid rewriting history.
      // Otherwise, prefer the current schedule's rate to automatically repair bad snapshots.
      const groupHasPaidJobs = paidCount > 0
      const monthlyRate = groupHasPaidJobs 
        ? firstJob.subcontractorRate 
        : (schedule?.defaultSubcontractorRate ?? firstJob.subcontractorRate)

      // For flat rate: owed = monthlyRate if ANY jobs are unpaid, else 0
      const hasUnpaid = unpaidCount > 0
      let groupOwed = 0
      if (hasUnpaid) {
        groupOwed += monthlyRate
        groupJobs.forEach((job: any) => {
          if (!job.subcontractorPaid) {
            job.addOnServices?.forEach((a: any) => { groupOwed += a.subcontractorRate })
          }
        })
      }
      totalOwed += groupOwed

      // Calculate total (all jobs) for reference
      let addOnTotal = 0
      groupJobs.forEach((job: any) => {
        job.addOnServices?.forEach((a: any) => { addOnTotal += a.subcontractorRate })
      })

      const monthDisplay = format(new Date(firstJob.date), 'MMMM yyyy')
      groups.push({
        clientId: key,
        clientName: clientDisplayName,
        payType: 'FLAT_RATE',
        jobs: groupJobs.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        monthlyAmount: monthlyRate,
        totalAmount: monthlyRate + addOnTotal,
        owedAmount: groupOwed,
        paidCount,
        unpaidCount,
        month: monthDisplay,
      })
    } else {
      // PER_CLEAN or one-off
      let groupTotalAmount = 0
      let groupOwedAmount = 0

      groupJobs.forEach((job: any) => {
        let jobTotal = job.subcontractorRate || 0
        job.addOnServices?.forEach((a: any) => { jobTotal += a.subcontractorRate || 0 })
        
        groupTotalAmount += jobTotal
        if (!job.subcontractorPaid) {
          groupOwedAmount += jobTotal
        }
      })

      totalOwed += groupOwedAmount

      groups.push({
        clientId: key,
        clientName: clientDisplayName,
        payType: 'PER_CLEAN',
        jobs: groupJobs.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        totalAmount: groupTotalAmount,
        owedAmount: groupOwedAmount,
        paidCount,
        unpaidCount,
      })
    }
  })

  // Sort unpaid/partially unpaid groups first, then fully paid
  groups.sort((a, b) => {
    const aUnpaid = a.unpaidCount > 0
    const bUnpaid = b.unpaidCount > 0
    if (aUnpaid && !bUnpaid) return -1
    if (!aUnpaid && bUnpaid) return 1
    return b.owedAmount - a.owedAmount
  })

  return { totalOwed, groups }
}
