import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { logger , getErrorMessage } from '@/lib/logger'

export async function GET() {
  try {
    // Validate Prisma is available before calling getCurrentUser
    if (!prisma) {
      logger.error('[Session] Prisma client not initialized')
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    const user = await getCurrentUser()
    
    if (!user) {
      // Log for debugging but don't expose details to client
      logger.debug('[Session] User not authenticated')
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    })
  } catch (error) {
    logger.error('[Session] Error:', getErrorMessage(error))
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
}

