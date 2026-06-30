import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createSubcontractorSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try {
    const subcontractors = await prisma.subcontractor.findMany({
      orderBy: {
        name: 'asc',
      },
    })
    return NextResponse.json(subcontractors)
  } catch (error) {
    logger.error('Error fetching subcontractors:', error)
    return NextResponse.json(
      { error: 'Failed to fetch subcontractors' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const body = await request.json()

    // Validate request body
    const validationResult = createSubcontractorSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }
    
    const subcontractor = await prisma.subcontractor.create({
      data: validationResult.data,
    })
    return NextResponse.json(subcontractor, { status: 201 })
  } catch (error) {
    logger.error('Error creating subcontractor:', error)
    return NextResponse.json(
      { error: 'Failed to create subcontractor' },
      { status: 500 }
    )
  }
}
