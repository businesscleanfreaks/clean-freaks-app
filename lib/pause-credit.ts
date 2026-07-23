export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateVisitPauseCredit(
  monthlyRate: number,
  skippedVisits: number,
  expectedVisits: number,
) {
  if (monthlyRate <= 0 || skippedVisits <= 0 || expectedVisits <= 0) return 0
  return Math.round(skippedVisits * (monthlyRate / expectedVisits))
}

export function calculateDayPauseCredit(
  monthlyRate: number,
  pausedDays: number,
  daysInMonth: number,
) {
  if (monthlyRate <= 0 || pausedDays <= 0 || daysInMonth <= 0) return 0
  return roundCurrency(Math.min(monthlyRate, monthlyRate * (pausedDays / daysInMonth)))
}
