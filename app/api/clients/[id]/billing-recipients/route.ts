import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { revalidateClientPages } from '@/lib/revalidate'
import { validateRecipients } from '@/lib/billing-recipients'
import { effectiveRecipients, recipientWrite, type RecipientChoice } from '@/lib/invoice-recipients'

export const dynamic = 'force-dynamic'

const CLIENT_FIELDS = {
  invoicingEmail: true,
  invoicingContactName: true,
  invoicingCcEmail: true,
  communicationEmail: true,
  communicationContactName: true,
} as const

const CONTACT_FIELDS = { id: true, name: true, email: true, billingRole: true } as const

async function load(clientId: string) {
  const [client, contacts] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: CLIENT_FIELDS }),
    prisma.clientContact.findMany({
      where: { clientId },
      select: CONTACT_FIELDS,
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    }),
  ])
  if (!client) return null
  const recipients = effectiveRecipients(client, contacts)
  const onList = new Set(recipients.map(r => r.email.toLowerCase()))
  return {
    recipients,
    // Contacts with an email who are not on the invoice yet, for "+ Add recipient".
    available: contacts.filter(c => c.email && !onList.has(c.email.toLowerCase())),
  }
}

/**
 * Who this client's invoices go to: the addresses sending actually uses (see
 * lib/invoice-recipients.ts), each named from the matching contact.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const data = await load(params.id)
    if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

/**
 * Replace the whole list in one write: the client's invoicing fields (what
 * sending reads) and the matching contacts' recipient flags, together. The
 * order is the meaning · the first address is greeted, the rest are CC'd.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const body = await request.json().catch(() => null)
    const choices: RecipientChoice[] = Array.isArray(body?.recipients)
      ? body.recipients
          .filter((r: unknown): r is RecipientChoice => !!r && typeof (r as RecipientChoice).email === 'string')
          .map((r: RecipientChoice) => ({ email: r.email, contactId: r.contactId ?? null, name: r.name ?? null }))
      : []

    const contacts = await prisma.clientContact.findMany({ where: { clientId: params.id }, select: CONTACT_FIELDS })

    // Never let one client's card name another client's contact.
    const ownIds = new Set(contacts.map(c => c.id))
    if (choices.some(c => c.contactId && !ownIds.has(c.contactId))) {
      return NextResponse.json({ error: 'That contact does not belong to this client.' }, { status: 400 })
    }

    const problems = validateRecipients(
      choices.map((c, i) => ({ id: c.contactId ?? `new-${i}`, name: c.name ?? '', email: c.email, billingRole: null, billingOrder: i })),
    )
    if (problems.length > 0) {
      return NextResponse.json({ error: problems[0].message, problems }, { status: 400 })
    }

    const write = recipientWrite(choices, contacts)
    await prisma.$transaction([
      prisma.client.update({ where: { id: params.id }, data: write.client }),
      ...write.flags.map(f =>
        prisma.clientContact.update({
          where: { id: f.contactId },
          data: { isBillingRecipient: f.billingOrder !== null, billingOrder: f.billingOrder },
        }),
      ),
    ])

    revalidateClientPages(params.id)
    return NextResponse.json(await load(params.id))
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
