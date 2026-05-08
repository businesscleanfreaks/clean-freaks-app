import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateSubcontractorPages } from '@/lib/revalidate'
import { createPaymentSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { getBillingStartDate } from '@/lib/billing-settings'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()
    
    // Validate request body
    const validationResult = createPaymentSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }
    
    const { jobIds, datePaid, notes } = validationResult.data

    // Get billing start date to prevent paying pre-cutoff jobs
    const billingStartDate = await getBillingStartDate()

    // Get the jobs with location, client info, and add-ons to calculate total correctly
    const jobs = await prisma.job.findMany({
      where: {
        id: { in: jobIds },
        subcontractorId: resolvedParams.id,
        subcontractorPaid: false, // Only allow paying unpaid jobs
        ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
      },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        addOnServices: true,
        schedule: true,
      },
    })

    if (jobs.length === 0) {
      return NextResponse.json(
        { error: 'No valid unpaid jobs found for this subcontractor' },
        { status: 400 }
      )
    }

    // Idempotency guard: if some requested jobs are already paid, return 409
    if (jobs.length < jobIds.length) {
      const foundIds = new Set(jobs.map(j => j.id))
      const alreadyPaid = jobIds.filter(id => !foundIds.has(id))
      return NextResponse.json(
        { error: `${alreadyPaid.length} job(s) already paid or not found`, alreadyPaidJobIds: alreadyPaid },
        { status: 409 }
      )
    }

    // Calculate total amount based on billing type
    // Group jobs by client and schedule to handle FLAT_RATE vs PER_CLEAN
    const jobsByClientSchedule = new Map<string, typeof jobs>()
    jobs.forEach(job => {
      const key = `${job.location.client.id}-${job.scheduleId || 'one-off'}`
      if (!jobsByClientSchedule.has(key)) {
        jobsByClientSchedule.set(key, [])
      }
      jobsByClientSchedule.get(key)!.push(job)
    })

    let totalAmount = 0
    const paymentLineItems: Array<{ jobId: string; amount: number }> = []

    jobsByClientSchedule.forEach((jobsGroup) => {
      if (jobsGroup.length === 0) return
      
      const isRecurring = jobsGroup[0].scheduleId !== null
      const subPayType = jobsGroup[0].schedule?.subcontractorPayType || 'PER_CLEAN'

      if (subPayType === 'FLAT_RATE' && isRecurring) {
        // For FLAT_RATE recurring jobs, only count the monthly rate once
        const firstJob = jobsGroup[0]
        const monthlyRate = firstJob.subcontractorRate
        let jobTotal = monthlyRate
        
        // Add add-on subcontractor rates for this job
        firstJob.addOnServices.forEach(addOn => {
          jobTotal += addOn.subcontractorRate
        })
        
        totalAmount += jobTotal
        // Create one line item for the first job representing the monthly rate + add-ons
        paymentLineItems.push({
          jobId: firstJob.id,
          amount: jobTotal,
        })
      } else {
        // For PER_CLEAN or one-off jobs, sum all rates and create line items for each
        jobsGroup.forEach(job => {
          let jobTotal = job.subcontractorRate
          
          // Add add-on subcontractor rates for this job
          job.addOnServices.forEach(addOn => {
            jobTotal += addOn.subcontractorRate
          })
          
          totalAmount += jobTotal
          paymentLineItems.push({
            jobId: job.id,
            amount: jobTotal,
          })
        })
      }
    })

    // Use transaction to ensure payment and job updates happen atomically
    const payment = await prisma.$transaction(async (tx) => {
      // Create the payment record with line items
      const newPayment = await tx.subcontractorPayment.create({
        data: {
          subcontractorId: resolvedParams.id,
          datePaid: datePaid ? new Date(datePaid + 'T12:00:00') : new Date(),
          totalAmount,
          notes: notes || null,
          lineItems: {
            create: paymentLineItems,
          },
        },
        include: {
          lineItems: {
            include: {
              job: {
                include: {
                  location: {
                    include: {
                      client: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      // Mark all jobs as paid
      await tx.job.updateMany({
        where: {
          id: { in: jobs.map(job => job.id) },
        },
        data: {
          subcontractorPaid: true,
        },
      })

      return newPayment
    })

    // Revalidate all subcontractor-related pages
    revalidateSubcontractorPages(resolvedParams.id)

    return NextResponse.json(payment, { status: 201 })
  } catch (error) {
    logger.error('Error creating payment:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create payment'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

