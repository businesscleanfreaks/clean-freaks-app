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

const createNoteSchema = z.object({
  text: z.string().min(1, "Note text is required"),
  category: z.string().optional(),
  isPinned: z.boolean().optional(),
  author: z.string().optional().nullable(),
})

// GET — list notes for a client (pinned first, then newest)
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth()
    const notes = await prisma.clientNote.findMany({
      where: { clientId: params.id },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    })
    return NextResponse.json(notes)
  } catch (error) {
    logger.error('List client notes error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load notes' },
      { status: 500 }
    )
  }
}

// POST — create a note
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth()
    const body = await request.json()

    const result = createNoteSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0].message },
        { status: 400 }
      )
    }

    const category = result.data.category && NOTE_CATEGORIES.includes(result.data.category)
      ? result.data.category
      : 'General'

    const note = await prisma.clientNote.create({
      data: {
        clientId: params.id,
        text: result.data.text.trim(),
        category,
        isPinned: result.data.isPinned ?? false,
        author: result.data.author || null,
      },
    })

    revalidateClientPages(params.id)
    return NextResponse.json(note, { status: 201 })
  } catch (error) {
    logger.error('Create client note error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create note' },
      { status: 500 }
    )
  }
}
