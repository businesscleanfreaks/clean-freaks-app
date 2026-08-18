/**
 * Invoice adjustments — the credits, discounts and charges a VA adds while
 * reviewing an invoice.
 *
 * Sign convention: `amount` is stored SIGNED. Credits (a discount, a comped
 * clean, a courtesy credit) are negative; a charge is positive. Keeping the
 * sign in the stored value means totalling is a plain sum and no caller has to
 * remember which modes subtract.
 */

export const ADJUSTMENT_MODES = ["PCT_OFF", "COMP", "COURTESY", "CHARGE"] as const
export type AdjustmentMode = (typeof ADJUSTMENT_MODES)[number]

export const MODE_LABELS: Record<AdjustmentMode, string> = {
  PCT_OFF: "% off a clean",
  COMP: "Comp a clean",
  COURTESY: "Courtesy credit",
  CHARGE: "Add a charge",
}

/** Only these two refer to a specific clean, so only they show a day picker. */
export const MODES_WITH_DAY: AdjustmentMode[] = ["PCT_OFF", "COMP"]
export const PCT_PRESETS = [10, 20, 30]

/** A charge adds to the invoice; everything else takes off it. */
export const isCharge = (mode: string) => mode === "CHARGE"

export interface Adjustment {
  id: string
  mode: string
  label: string
  /** Signed: negative for credits, positive for charges. */
  amount: number
  serviceDay: number | null
  approved: boolean
}

/**
 * Reads a money string the way an operator types it: "$1,950", "1 950.50",
 * "(20)" are all understood. Returns null when there is no usable number, so
 * callers can tell "nothing entered" from "zero".
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null
  if (input == null) return null
  const cleaned = String(input).replace(/[^0-9.\-]/g, "")
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** The per-clean value a percentage or comp is calculated from. */
export function perCleanValue(params: {
  billingType: string
  total: number
  cleanCount: number
  /** Service days used to spread a flat monthly rate. */
  flatServiceDays?: number
}): number {
  const { billingType, total, cleanCount, flatServiceDays = 21 } = params
  if (billingType === "FLAT_RATE") {
    return flatServiceDays > 0 ? round2(total / flatServiceDays) : 0
  }
  return cleanCount > 0 ? round2(total / cleanCount) : 0
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** Amount taken off for a percentage discount on one clean. */
export function pctOffAmount(perClean: number, pct: number): number {
  return round2((perClean * pct) / 100)
}

/**
 * Turns what the operator entered into the stored SIGNED amount.
 * Returns null when the entry is unusable, so nothing silently becomes 0.
 */
export function signedAmount(mode: string, rawAmount: string | number | null): number | null {
  const value = parseMoney(rawAmount)
  if (value === null) return null
  const magnitude = Math.abs(value)
  if (magnitude === 0) return null
  return isCharge(mode) ? round2(magnitude) : round2(-magnitude)
}

export function adjustmentsTotal(list: Adjustment[]): number {
  return round2(list.reduce((sum, a) => sum + a.amount, 0))
}

/** Invoice total once adjustments are applied. */
export function adjustedTotal(baseTotal: number, list: Adjustment[]): number {
  return round2(baseTotal + adjustmentsTotal(list))
}

/**
 * An invoice cannot be sent while any adjustment is still unapproved — the
 * design makes approval an explicit, per-row decision.
 */
export function allApproved(list: Adjustment[]): boolean {
  return list.every(a => a.approved)
}

export function pendingCount(list: Adjustment[]): number {
  return list.filter(a => !a.approved).length
}

/** Why sending is blocked, or null when it is fine to send. */
export function sendBlockedReason(list: Adjustment[]): string | null {
  const pending = pendingCount(list)
  if (pending === 0) return null
  return `Approve ${pending} adjustment${pending === 1 ? "" : "s"} before sending`
}

/** Default label when the operator leaves it blank. */
export function defaultLabel(mode: string, serviceDay: number | null): string {
  const day = serviceDay ? ` · day ${serviceDay}` : ""
  switch (mode) {
    case "PCT_OFF": return `Discount${day}`
    case "COMP": return `Comped clean${day}`
    case "CHARGE": return "Additional charge"
    default: return "Courtesy credit"
  }
}

export function isValidMode(mode: unknown): mode is AdjustmentMode {
  return typeof mode === "string" && (ADJUSTMENT_MODES as readonly string[]).includes(mode)
}
