import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateJobPages, revalidateInvoicePages, revalidateClientPages } from '@/lib/revalidate'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { cascadeAddOnUpdate } from '@/lib/cascading-updates'
import { requireAuth } from '@/lib/auth'

const createAddOnServiceSchema = z.object({
  jobId: z.string().uuid('Invalid job ID').optional().nullable(),
  scheduleId: z.string().uuid('Invalid schedule ID').optional().nullable(),
  description: z.string().min(1, 'Description is required'),
  clientRate: z.number().min(0, 'Client rate must be positive'),
  subcontractorRate: z.number().min(0, 'Subcontractor rate must be positive'),
  frequency: z.string().optional().nullable(),
  isRecurring: z.boolean().optional().default(false),
  outsourcedVendor: z.string().optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
})

export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()

    const validationResult = createAddOnServiceSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }

    const { jobId, scheduleId, description, clientRate, subcontractorRate, frequency, isRecurring, outsourcedVendor, vendorId } = validationResult.data

    // For recurring add-ons, scheduleId is required
    if (isRecurring && !scheduleId) {
      return NextResponse.json(
        { error: 'Schedule ID is required for recurring add-ons' },
        { status: 400 }
      )
    }

    // For one-time add-ons, jobId is required
    if (!isRecurring && !jobId) {
      return NextResponse.json(
        { error: 'Job ID is required for one-time add-ons' },
        { status: 400 }
      )
    }

    // If jobId is provided, check for paid invoice restriction
    if (jobId) {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
          invoiceLineItems: {
            include: {
              invoice: true,
            },
          },
        },
      })

      if (!job) {
        return NextResponse.json(
          { error: 'Job not found' },
          { status: 404 }
        )
      }

      const hasPaidInvoice = job.invoiceLineItems.some(item => item.invoice.status === 'PAID')
      if (hasPaidInvoice) {
        return NextResponse.json(
          { error: 'Cannot add add-on service: job has a paid invoice' },
          { status: 400 }
        )
      }
    }

    const addOnService = await prisma.addOnService.create({
      data: {
        jobId: jobId || null,
        scheduleId: scheduleId || null,
        description,
        clientRate,
        subcontractorRate,
        frequency: isRecurring ? frequency : null,
        isRecurring,
        outsourcedVendor: outsourcedVendor || null,
        vendorId: vendorId || null,
      },
      include: {
        schedule: {
          include: {
            location: {
              include: {
                client: true,
              },
            },
          },
        },
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
    })

    // Revalidate related pages
    revalidateJobPages()
    const clientId = addOnService.schedule?.location.client.id || addOnService.job?.location.client.id
    if (clientId) {
      revalidateClientPages(clientId)
      revalidateInvoicePages(clientId)
    }

    // Trigger cascading updates
    await cascadeAddOnUpdate(addOnService.id, 'create', addOnService.jobId || null)

    return NextResponse.json(addOnService)
  } catch (error) {
    logger.error('Error creating add-on service:', error)
    return NextResponse.json(
      { error: 'Failed to create add-on service' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const scheduleId = searchParams.get('scheduleId')

    if (scheduleId) {
      // Get recurring add-ons for a specific schedule
      const addOns = await prisma.addOnService.findMany({
        where: {
          scheduleId,
          isRecurring: true,
        },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json(addOns)
    }

    // Get all add-ons
    const addOns = await prisma.addOnService.findMany({
      include: {
        schedule: {
          include: {
            location: {
              include: {
                client: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(addOns)
  } catch (error) {
    logger.error('Error fetching add-ons:', error)
    return NextResponse.json(
      { error: 'Failed to fetch add-ons' },
      { status: 500 }
    )
  }
}
