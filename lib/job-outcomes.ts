type OutcomeDisplay = {
  key: 'skipped' | 'no-access' | 're-clean'
  shortLabel: string
  fullLabel: string
  badgeClassName: string
}

const OUTCOME_PREFIXES: Array<{ prefix: string; display: OutcomeDisplay }> = [
  {
    prefix: 'Skipped:',
    display: {
      key: 'skipped',
      shortLabel: 'Skipped',
      fullLabel: 'Skipped',
      badgeClassName: 'bg-amber-100 text-amber-800',
    },
  },
  {
    prefix: 'No Access / No Show:',
    display: {
      key: 'no-access',
      shortLabel: 'No Show',
      fullLabel: 'No Access / No Show',
      badgeClassName: 'bg-orange-100 text-orange-800',
    },
  },
  {
    prefix: 'Re-clean / Make Good:',
    display: {
      key: 're-clean',
      shortLabel: 'Re-clean',
      fullLabel: 'Re-clean / Make Good',
      badgeClassName: 'bg-sky-100 text-sky-800',
    },
  },
]

export function getJobOutcomeDisplay(notes?: string | null): OutcomeDisplay | null {
  if (!notes) return null

  const match = OUTCOME_PREFIXES.find((item) => notes.startsWith(item.prefix))
  return match?.display ?? null
}
