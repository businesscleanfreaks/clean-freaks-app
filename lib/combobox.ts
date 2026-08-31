/**
 * The combobox filtering rule the handoff uses everywhere.
 *
 * Options filter by PREFIX, not substring: typing "Ch" offers "Check" but not
 * "Carpet cleaning". Prefix matching is what makes a short list feel like it is
 * completing what you typed rather than searching it.
 *
 * When nothing matches, the list closes and whatever was typed stands as a
 * custom value — these fields accept anything, the options are a shortcut.
 */

export function filterByPrefix(options: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter(o => o.toLowerCase().startsWith(q))
}

/** The list is only worth showing when it has something to offer. */
export function shouldShowOptions(options: string[], query: string): boolean {
  return filterByPrefix(options, query).length > 0
}

/** Vendor specialties · the Calendar's service list. */
export const SERVICE_TYPES = ["Pressure washing", "Window washing", "Carpet cleaning"]

/** How we pay a cleaner or vendor. */
export const PAY_METHOD_OPTIONS = ["Zelle", "ACH transfer", "Check", "Cash"]

/** Standard points of contact. */
export const CONTACT_ROLES = [
  "Owner",
  "Billing",
  "Scheduling",
  "Team lead",
  "Supervisor",
  "Office manager",
  "Emergency contact",
]
