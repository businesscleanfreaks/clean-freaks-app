import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, hashPassword } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { validateNewTeammate, normalizeEmail } from '@/lib/team'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Never select passwordHash — it must not leave the server.
const SAFE_USER_SELECT = { id: true, email: true, name: true, createdAt: true } as const

export async function GET() {
  try {
    const currentUser = await requireAuth()
    const users = await prisma.user.findMany({
      select: SAFE_USER_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ users, currentUserId: currentUser.id })
  } catch (error) {
    return handleApiError(error, 'Failed to load team')
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()

    const input = {
      name: typeof body.name === 'string' ? body.name : '',
      email: typeof body.email === 'string' ? body.email : '',
      password: typeof body.password === 'string' ? body.password : '',
    }

    const validationError = validateNewTeammate(input)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const email = normalizeEmail(input.email)
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'That email already has an account.' }, { status: 409 })
    }

    const user = await prisma.user.create({
      data: {
        name: input.name.trim(),
        email,
        passwordHash: await hashPassword(input.password),
      },
      select: SAFE_USER_SELECT,
    })

    logger.info(`[team] teammate added: ${email}`)
    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Failed to add teammate')
  }
}
