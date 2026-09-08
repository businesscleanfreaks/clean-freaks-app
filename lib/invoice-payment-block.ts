/**
 * What the payment section of a client-facing invoice says.
 *
 * This exists because both surfaces used to hardcode Zelle. The PDF printed
 * the literal label "Zelle" and our Zelle address on every invoice, and the
 * on-screen preview printed a fixed "Please send payment via Zelle" box, so a
 * client who pays by cheque or through their own AP portal was told to send
 * money somewhere they do not pay us. On a document a client acts on, that is
 * worse than printing nothing.
 *
 * Two rules matter here:
 *
 *  - A payment method is only ever printed when it is THIS client's method.
 *  - A portal client's invoice carries no payment details at all. They pay
 *    through their own system, so our bank details invite a second payment ·
 *    and the stored PORTAL template is a note written for Josh, describing
 *    what the app does. It must never reach a client.
 *
 * Pure: no Prisma, no React. Both the PDF and the preview read from here so
 * they cannot drift apart again.
 */

import { FOOTER_METHODS, resolveInvoiceFooter, type FooterMethod, type InvoiceFooterTemplates } from "./billing-sections"

export type PayMethod = FooterMethod

/** One label/value pair in the payment details column. */
export interface PaymentDetail {
  label: string
  value: string
  /** A quieter second line, e.g. "(DBA The Clean Freaks)". */
  sub?: string | null
}

export interface PaymentBlock {
  /** Heading for the details column. Null means print no details at all. */
  title: string | null
  details: PaymentDetail[]
  /** Instructions to print as plain text. Null means print nothing. */
  instructions: string | null
  /** The "request another method · card and PayPal carry a fee" line. */
  showFeeNotice: boolean
}

export interface PaymentBlockInput {
  /** The client's own method: ZELLE | ACH | PORTAL | CHECK, or unset. */
  payMethod?: string | null
  /**
   * How clients pay when none is recorded against them.
   *
   * Every client currently has an empty `payMethod`, so without a default the
   * fix for "stop telling everyone to pay by Zelle" would print no way to pay
   * at all. This keeps the business's usual method printing until each client
   * is set, and a client's own method always wins over it.
   */
  fallbackMethod?: string | null
  paymentEmail?: string | null
  legalName?: string | null
  /** "(DBA The Clean Freaks)", when the trading name differs. */
  dba?: string | null
  mailingAddress?: string | null
  /**
   * The per-method note templates. The block picks the one matching the method
   * it decided on.
   *
   * Resolved HERE rather than by the caller. When the preview resolved the note
   * separately it forced a method to fill the argument, and a client marked TBD
   * got an empty details column above a line reading "Pay by Zelle" · the two
   * halves of the same answer disagreeing because two places computed it.
   */
  templates?: InvoiceFooterTemplates | null
  /** Printed when no method-specific template applies. */
  genericNote?: string | null
}

const clean = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim()

/**
 * The method as one of the four we know, or null when it cannot be told.
 *
 * `preferredPaymentMethod` is free text typed by hand, and the live values are
 * not the enum names · "Direct Deposit (Client-Controlled)", "TBD", "Check".
 * Matching only the enum names sent four client-controlled accounts down the
 * default path and printed our Zelle address on their invoices, which is the
 * exact thing this file exists to stop.
 */
export function normalizePayMethod(raw: unknown): PayMethod | null {
  const key = clean(raw).toUpperCase()
  if (!key) return null
  if ((FOOTER_METHODS as readonly string[]).includes(key)) return key as PayMethod

  // "Client-controlled" means the client pushes the payment from their own
  // system · same as an AP portal, so we print nothing and let them run it.
  if (/CLIENT[-\s]?CONTROLLED|PORTAL|MELIO|BILL\.COM/.test(key)) return "PORTAL"
  if (/ZELLE/.test(key)) return "ZELLE"
  if (/CHECK|CHEQUE/.test(key)) return "CHECK"
  if (/ACH|DIRECT DEPOSIT|BANK TRANSFER|WIRE/.test(key)) return "ACH"

  // "TBD", "n/a" and anything else unrecognised stay null on purpose: an
  // undecided method is not a licence to guess one.
  return null
}

/** Values that say "not settled yet" rather than naming a method. */
const UNDECIDED = /^(TBD|N\/?A|NONE|UNKNOWN|\?+|-+)$/

/**
 * True when someone has recorded that the method is not settled.
 *
 * Different from an empty field: a blank is nobody having filled it in, while
 * "TBD" is a person saying it is open. The blank can take the house default;
 * this cannot.
 */
export function isUndecidedPayMethod(raw: unknown): boolean {
  const key = clean(raw).toUpperCase()
  return key.length > 0 && UNDECIDED.test(key)
}

/**
 * Nothing at all · the shape returned for a portal client.
 *
 * Named rather than inlined because "print nothing" is a deliberate decision
 * here, not an empty default.
 */
const PRINT_NOTHING: PaymentBlock = {
  title: null,
  details: [],
  instructions: null,
  showFeeNotice: false,
}

/**
 * The payment section for one invoice.
 *
 * Never falls back to another client's method: when we do not know how this
 * client pays, the details column is omitted and only the generic note prints.
 */
export function buildPaymentBlock(input: PaymentBlockInput): PaymentBlock {
  // An explicit "TBD" blocks the house default; a blank field does not.
  const method = isUndecidedPayMethod(input.payMethod)
    ? null
    : normalizePayMethod(input.payMethod) ?? normalizePayMethod(input.fallbackMethod)

  // The client pays through their own AP system. Printing our bank details
  // invites a duplicate payment, and the stored template is an internal note.
  if (method === "PORTAL") return PRINT_NOTHING

  // One method, one note. `method` is null for an undecided client, so
  // `resolveInvoiceFooter` falls through to the generic note rather than
  // printing another method's payment details.
  const resolved = input.templates
    ? resolveInvoiceFooter(input.templates, method, clean(input.genericNote) || null)
    : clean(input.genericNote) || null
  const instructions = clean(resolved) || null
  const details: PaymentDetail[] = []

  if (method === "ZELLE") {
    const email = clean(input.paymentEmail)
    if (email) details.push({ label: "Zelle", value: email })
  }

  if (method === "CHECK") {
    const address = clean(input.mailingAddress)
    if (address) details.push({ label: "Mail a cheque to", value: address })
  }

  // Who the money is going to. Worth printing whenever we are naming an
  // account, because the name on the transfer is not the trading name.
  const legal = clean(input.legalName)
  if (legal && details.length > 0) {
    details.push({ label: "Full name", value: legal, sub: clean(input.dba) || null })
  }

  return {
    title: details.length > 0 ? "Preferred payment option:" : null,
    details,
    instructions,
    // ACH and cheque payers can still ask for a card; a portal client cannot.
    showFeeNotice: method !== null,
  }
}

/** True when the invoice should print no payment section whatsoever. */
export function printsNoPaymentSection(block: PaymentBlock): boolean {
  return block.title === null && block.instructions === null && block.details.length === 0
}
