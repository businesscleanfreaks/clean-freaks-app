import { format } from 'date-fns'

export function parseDateOnly(value?: Date | string | null): Date | null {
  if (!value) return null

  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) {
      const [, year, month, day] = match
      return new Date(Number(year), Number(month) - 1, Number(day))
    }
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function parseDateOnlyForStorage(value?: Date | string | null): Date | null {
  if (!value) return null

  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) {
      const [, year, month, day] = match
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0))
    }
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0))
}

export function dateInputValue(value?: Date | string | null): string {
  const date = parseDateOnly(value)
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateOnly(value?: Date | string | null, pattern = 'MMM d, yyyy'): string | null {
  const date = parseDateOnly(value)
  return date ? format(date, pattern) : null
}
