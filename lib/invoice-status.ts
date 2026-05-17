export type InvoiceStatusLike = string | null | undefined

export type InvoiceLineItemLike = {
  invoice?: {
    status?: InvoiceStatusLike
  } | null
} | null | undefined

export function isFinalInvoiceStatus(status: InvoiceStatusLike): boolean {
  return status === 'SENT' || status === 'PAID'
}

export function isPaidInvoiceStatus(status: InvoiceStatusLike): boolean {
  return status === 'PAID'
}

export function isDraftInvoiceStatus(status: InvoiceStatusLike): boolean {
  return status === 'DRAFT'
}

export function hasFinalInvoice(lineItems: InvoiceLineItemLike[] | null | undefined): boolean {
  return (lineItems || []).some((item) => isFinalInvoiceStatus(item?.invoice?.status))
}

export function hasPaidInvoice(lineItems: InvoiceLineItemLike[] | null | undefined): boolean {
  return (lineItems || []).some((item) => isPaidInvoiceStatus(item?.invoice?.status))
}

export function hasDraftInvoice(lineItems: InvoiceLineItemLike[] | null | undefined): boolean {
  return (lineItems || []).some((item) => isDraftInvoiceStatus(item?.invoice?.status))
}
