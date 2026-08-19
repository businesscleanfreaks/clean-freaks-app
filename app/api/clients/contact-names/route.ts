import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Billing-contact first names, per client.
 *
 * Feeds the compose window's pre-send check: the VA usually writes this
 * month's email on top of last month's, and the mistake that survives a
 * read-through is another client's name in the greeting. Catching it needs to
 * know who the other clients' contacts are.
 *
 * First names only — this is a spell-check list, not a contact export, and it
 * carries no addresses.
 */
export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const clients = await prisma.client.findMany({
      select: {
        id: true,
        invoicingContactName: true,
        communicationContactName: true,
        contacts: { select: { name: true } },
      },
    })

    const names = clients.map(c => {
      const seen = new Set<string>()
      const first: string[] = []
      for (const raw of [c.invoicingContactName, c.communicationContactName, ...c.contacts.map(x => x.name)]) {
        const name = (raw || '').trim().split(/\s+/)[0]
        if (!name || seen.has(name.toLowerCase())) continue
        seen.add(name.toLowerCase())
        first.push(name)
      }
      return { clientId: c.id, firstNames: first }
    })

    return NextResponse.json(
      { names },
      { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' } },
    )
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
