import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// Create a single job for a specific schedule and date
export async function POST(request: Request) {
  try {
    await requireAuth()
    const { scheduleId, date } = await request.json()
    
    if (!scheduleId || !date) {
      return NextResponse.json({ error: 'scheduleId and date are required' }, { status: 400 })
    }

    // Get the schedule
    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: {
        location: { include: { client: true } }
      }
    })

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    // Check if job already exists for this date
    const existingJob = await prisma.job.findFirst({
      where: {
        scheduleId: scheduleId,
        date: new Date(date),
      }
    })

    if (existingJob) {
      return NextResponse.json({
        message: 'Job already exists for this date',
        job: existingJob
      })
    }

    // Create the job
    const job = await prisma.job.create({
      data: {
        scheduleId: schedule.id,
        locationId: schedule.locationId,
        subcontractorId: schedule.subcontractorId,
        date: new Date(date),
        startTime: schedule.startTime,
        startWindowBegin: schedule.startWindowBegin,
        startWindowEnd: schedule.startWindowEnd,
        clientRate: schedule.defaultClientRate,
        subcontractorRate: schedule.defaultSubcontractorRate,
        status: 'SCHEDULED',
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Job created',
      job: {
        id: job.id,
        date: job.date,
        status: job.status,
        clientRate: job.clientRate,
      },
      client: schedule.location.client.name,
    })
  } catch (error) {
    console.error('Error creating job:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
