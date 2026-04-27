type InvoiceRevisionDates = {
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
}

const REVISION_THRESHOLD_MS = 1000

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function getInvoiceRevisionInfo(invoice: InvoiceRevisionDates) {
  const createdAt = toDate(invoice.createdAt)
  const updatedAt = toDate(invoice.updatedAt)

  if (!createdAt || !updatedAt) {
    return { isRevised: false, revisedAt: null as Date | null }
  }

  if (updatedAt.getTime() - createdAt.getTime() <= REVISION_THRESHOLD_MS) {
    return { isRevised: false, revisedAt: null as Date | null }
  }

  return {
    isRevised: true,
    revisedAt: updatedAt,
  }
}
