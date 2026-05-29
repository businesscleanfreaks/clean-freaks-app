import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { revalidateClientPages } from "@/lib/revalidate"
import { logger } from "@/lib/logger"
import { z } from "zod"

export const dynamic = 'force-dynamic'

const NOTE_CATEGORIES = [
  "General",
  "Scheduling",
  "Billing",
  "Access",
  "Complaint",
  "Cleaner Note",
  "Client Preference",
]

const updateNoteSchema = z.object({
  text: z.string().min(1).optional(),
  category: z.string().optional(),
  isPinned: z.boolean().optional(),
})

// PATCH — edit a note (text / category / pin)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; noteId: string } }
) {
  try {
    await requireAuth()
    const body = await request.json()

    const result = updateNoteSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0].message },
        { status: 400 }
      )
    }

    const data: Record<string, unknown> = {}
    if (result.data.text !== undefined) data.text = result.data.text.trim()
    if (result.data.isPinned !== undefined) data.isPinned = result.data.isPinned
    if (result.data.category !== undefined) {
      data.category = NOTE_CATEGORIES.includes(result.data.category) ? result.data.category : 'General'
    }

    const updated = await prisma.clientNote.updateMany({
      where: { id: params.noteId, clientId: params.id },
      data,
    })

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    revalidateClientPages(params.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Update client note error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update note' },
      { status: 500 }
    )
  }
}

// DELETE — remove a note
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; noteId: string } }
) {
  try {
    await requireAuth()
    const deleted = await prisma.clientNote.deleteMany({
      where: { id: params.noteId, clientId: params.id },
    })

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    revalidateClientPages(params.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Delete client note error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete note' },
      { status: 500 }
    )
  }
}
