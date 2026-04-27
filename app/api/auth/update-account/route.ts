import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth, hashPassword, verifyPassword } from '@/lib/auth'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'

export async function PUT(request: Request) {
  try {
    // Require authentication
    const currentUser = await requireAuth()

    const body = await request.json()
    const { email, currentPassword, newPassword } = body

    // Get current user from database
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
    })

    if (!user) {
      return createErrorResponse('User not found', 404, 'NOT_FOUND')
    }

    const updates: Record<string, string> = {}

    // Handle email update
    if (email) {
      if (email === user.email) {
        return createErrorResponse('New email must be different from current email', 400, 'VALIDATION_ERROR')
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        return createErrorResponse('Invalid email format', 400, 'VALIDATION_ERROR')
      }

      // Check if email is already taken
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
      })

      if (existingUser && existingUser.id !== user.id) {
        return createErrorResponse('Email is already in use', 400, 'VALIDATION_ERROR')
      }

      updates.email = email.toLowerCase().trim()
    }

    // Handle password update
    if (newPassword) {
      if (!currentPassword) {
        return createErrorResponse('Current password is required to change password', 400, 'VALIDATION_ERROR')
      }

      // Verify current password
      const isValidPassword = await verifyPassword(currentPassword, user.passwordHash)
      if (!isValidPassword) {
        return createErrorResponse('Current password is incorrect', 401, 'AUTH_ERROR')
      }

      // Validate new password strength
      if (newPassword.length < 8) {
        return createErrorResponse('Password must be at least 8 characters long', 400, 'VALIDATION_ERROR')
      }

      // Hash new password
      updates.passwordHash = await hashPassword(newPassword)
    }

    // If no updates provided
    if (Object.keys(updates).length === 0) {
      return createErrorResponse('No updates provided', 400, 'VALIDATION_ERROR')
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updates,
      select: {
        id: true,
        email: true,
        name: true,
      },
    })

    return NextResponse.json({
      success: true,
      user: updatedUser,
      message: email ? 'Email updated successfully' : 'Password updated successfully',
    })
  } catch (error) {
    return handleApiError(error, 'Failed to update account')
  }
}

