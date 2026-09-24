/**
 * Who a client's invoices go to, with one source of truth.
 *
 * Invoices are sent to the client's invoicing email, copied to its CC list
 * (falling back to the communication email). The Billing tab's recipient card
 * used to read a separate flag on contacts, which nothing kept in step with
 * those fields · no contact is flagged in the live data, so the card said
 * "no recipients" while invoices went out to someone.
 *
 * So the client fields stay the truth, because they are what sending uses.
 * The card shows them, named from the matching contact, and saving the card
 * rewrites the fields and mirrors the contact flags in one write.
 *
 * Pure: no Prisma.
 */

export interface RecipientContact {
  id: string
  name: string
  email: string | null
  billingRole?: string | null
}

export interface RecipientClientFields {
  invoicingEmail: string | null
  invoicingContactName: string | null
  invoicingCcEmail: string | null
  communicationEmail: string | null
  communicationContactName: string | null
}

export interface EffectiveRecipient {
  email: string
  name: string | null
  contactId: string | null
  billingRole: string | null
  tag: "TO" | "CC"
}

const norm = (email: string) => email.trim().toLowerCase()

/** "a@x.com, b@x.com; c@x.com" → three addresses. */
export function splitEmails(raw: string | null | undefined): string[] {
  return (raw ?? "").split(/[,;\s]+/).map(e => e.trim()).filter(Boolean)
}

/** The addresses an invoice goes to today, first one greeted. */
export function effectiveRecipients(client: RecipientClientFields, contacts: RecipientContact[]): EffectiveRecipient[] {
  const byEmail = new Map(contacts.filter(c => c.email).map(c => [norm(c.email as string), c]))
  const to = (client.invoicingEmail || client.communicationEmail || "").trim()
  const toName = client.invoicingEmail ? client.invoicingContactName : client.communicationContactName
  const seen = new Set<string>()
  const out: EffectiveRecipient[] = []
  const add = (email: string, fallbackName: string | null, tag: "TO" | "CC") => {
    if (!email || seen.has(norm(email))) return
    seen.add(norm(email))
    const contact = byEmail.get(norm(email))
    out.push({
      email,
      name: contact?.name ?? fallbackName ?? null,
      contactId: contact?.id ?? null,
      billingRole: contact?.billingRole ?? null,
      tag,
    })
  }
  add(to, toName?.trim() || null, "TO")
  splitEmails(client.invoicingCcEmail).forEach(email => add(email, null, out.length === 0 ? "TO" : "CC"))
  return out
}

export interface RecipientChoice {
  email: string
  contactId?: string | null
  name?: string | null
}

export interface RecipientWrite {
  client: { invoicingEmail: string | null; invoicingContactName: string | null; invoicingCcEmail: string | null }
  /** Every contact's recipient flag: its place in the list, or null when not on it. */
  flags: Array<{ contactId: string; billingOrder: number | null }>
}

/** What saving the card writes. Duplicates collapse; order is kept. */
export function recipientWrite(choices: RecipientChoice[], contacts: RecipientContact[]): RecipientWrite {
  const byId = new Map(contacts.map(c => [c.id, c]))
  const byEmail = new Map(contacts.filter(c => c.email).map(c => [norm(c.email as string), c]))
  const seen = new Set<string>()
  const list = choices
    .map(c => ({ ...c, email: c.email.trim() }))
    .filter(c => c.email && !seen.has(norm(c.email)) && seen.add(norm(c.email)))
    .map(c => ({ ...c, contact: (c.contactId && byId.get(c.contactId)) || byEmail.get(norm(c.email)) || null }))

  const [first, ...rest] = list
  const order = new Map<string, number>()
  list.forEach((c, i) => { if (c.contact && !order.has(c.contact.id)) order.set(c.contact.id, i) })

  return {
    client: {
      invoicingEmail: first?.email ?? null,
      invoicingContactName: first ? (first.contact?.name ?? first.name?.trim() ?? null) || null : null,
      invoicingCcEmail: rest.length > 0 ? rest.map(c => c.email).join(", ") : null,
    },
    flags: contacts.map(c => ({ contactId: c.id, billingOrder: order.get(c.id) ?? null })),
  }
}
