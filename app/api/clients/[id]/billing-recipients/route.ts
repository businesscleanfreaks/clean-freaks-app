import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { revalidateClientPages } from '@/lib/revalidate'
import { orderRecipients, validateRecipients } from '@/lib/billing-recipients'

export const dynamic = 'force-dynamic'

/**
 * The client's invoice recipients, in the order the client sees them: the
 * first is addressed by name, the rest are CC'd.
 *
 * Recipients are contacts (the handoff: "edits sync with the contact record"),
 * so this reads and writes ClientContact rather than keeping a second list.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const contacts = await prisma.clientContact.findMany({
      where: { clientId: params.id },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        isBillingRecipient: true, billingOrder: true, billingRole: true,
      },
      orderBy: [{ billingOrder: 'asc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json(
      {
        recipients: orderRecipients(contacts.filter(c => c.isBillingRecipient)),
        // Contacts not on the invoice yet, for "+ Add another recipient".
        available: contacts.filter(c => !c.isBillingRecipient),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

interface IncomingRecipient {
  id: string
  billingRole?: string | null
  email?: string | null
  name?: string | null
}

/**
 * Replace the whole recipient list in one write.
 *
 * Whole-list rather than per-row because the ORDER is the meaning here: saving
 * rows one at a time would leave the greeting pointing at the wrong person
 * between requests.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const body = await request.json().catch(() => null)
    const incoming: IncomingRecipient[] = Array.isArray(body?.recipients) ? body.recipients : []

    const owned = await prisma.clientContact.findMany({
      where: { clientId: params.id },
      select: { id: true, name: true, email: true },
    })
    const ownedById = new Map(owned.map(c => [c.id, c]))

    // Never let one client's card reassign another client's contact.
    const foreign = incoming.find(r => !ownedById.has(r.id))
    if (foreign) {
      return NextResponse.json({ error: 'That contact does not belong to this client.' }, { status: 400 })
    }

    const problems = validateRecipients(
      incoming.map((r, i) => ({
        id: r.id,
        name: (r.name ?? ownedById.get(r.id)?.name ?? '') as string,
        email: (r.email ?? ownedById.get(r.id)?.email ?? null) as string | null,
        billingRole: r.billingRole ?? null,
        billingOrder: i,
      })),
    )
    if (problems.length > 0) {
      return NextResponse.json({ error: problems[0].message, problems }, { status: 400 })
    }

    const keep = new Set(incoming.map(r => r.id))
    await prisma.$transaction([
      // Anyone dropped from the card stays a contact, just not a recipient.
      prisma.clientContact.updateMany({
        where: { clientId: params.id, id: { notIn: [...keep] } },
        data: { isBillingRecipient: false, billingOrder: null },
      }),
      ...incoming.map((r, i) =>
        prisma.clientContact.update({
          where: { id: r.id },
          data: {
            isBillingRecipient: true,
            billingOrder: i,
            ...(r.billingRole !== undefined && { billingRole: r.billingRole?.trim() || null }),
            ...(r.email !== undefined && { email: r.email?.trim() || null }),
            ...(r.name != null && r.name.trim() ? { name: r.name.trim() } : {}),
          },
        }),
      ),
    ])

    revalidateClientPages(params.id)

    const contacts = await prisma.clientContact.findMany({
      where: { clientId: params.id },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        isBillingRecipient: true, billingOrder: true, billingRole: true,
      },
      orderBy: [{ billingOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({
      recipients: orderRecipients(contacts.filter(c => c.isBillingRecipient)),
      available: contacts.filter(c => !c.isBillingRecipient),
    })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
