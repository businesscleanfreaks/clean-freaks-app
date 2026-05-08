// Frequency multipliers for monthly calculations
// Uses exact math: annualize with 52 weeks/year, divide by 12 months
// NEVER round inside calculations — only round for display

export const FREQUENCY_MULTIPLIERS: Record<string, number> = {
  // Standard frequencies (exact 52/12 math)
  'DAILY': (7 * 52) / 12,        // 30.333333... (7x per week)
  'WEEKLY': 52 / 12,              // 4.333333...  (1x per week)
  'BI_WEEKLY': 26 / 12,           // 2.166666...  (every 2 weeks)
  'MONTHLY': 1,                   // 1x per month

  // Extended frequencies (exact math)
  'EVERY_2_WEEKS': 26 / 12,       // 2.166666...  (same as bi-weekly)
  'EVERY_3_WEEKS': 52 / (3 * 12), // 1.444444...
  'EVERY_4_WEEKS': 52 / (4 * 12), // 1.083333...
  'EVERY_5_WEEKS': 52 / (5 * 12), // 0.866666...
  'EVERY_6_WEEKS': 52 / (6 * 12), // 0.722222...

  // Multi-day frequencies (exact math)
  '2X_WEEKLY': (2 * 52) / 12,     // 8.666666...  (2x per week)
  '3X_WEEKLY': (3 * 52) / 12,     // 13           (3x per week)
  '4X_WEEKLY': (4 * 52) / 12,     // 17.333333... (4x per week)
  '5X_WEEKLY': (5 * 52) / 12,     // 21.666666... (5x per week)

  // Monthly variations
  '2X_MONTHLY': 2,                // 2x per month
  '3X_MONTHLY': 3,                // 3x per month
}

/**
 * Get the average occurrences per month for a frequency
 */
export function getAvgOccurrencesPerMonth(frequency: string, daysOfWeek?: string | null): number {
  // If we have days of week, count them and multiply by the per-day factor
  if (daysOfWeek) {
    try {
      const days = JSON.parse(daysOfWeek)
      if (Array.isArray(days) && days.length > 0) {
        // Each day of week = 52/12 occurrences per month (exact)
        if (frequency === 'WEEKLY' || frequency === 'DAILY') {
          return days.length * (52 / 12)
        }
        if (frequency === 'BI_WEEKLY' || frequency === 'EVERY_2_WEEKS') {
          return days.length * (26 / 12)
        }
        if (frequency === 'EVERY_3_WEEKS') {
          return days.length * (52 / (3 * 12))
        }
        if (frequency === 'EVERY_4_WEEKS') {
          return days.length * (52 / (4 * 12))
        }
        if (frequency === 'EVERY_5_WEEKS') {
          return days.length * (52 / (5 * 12))
        }
        if (frequency === 'EVERY_6_WEEKS') {
          return days.length * (52 / (6 * 12))
        }
      }
    } catch {
      // Fall through to standard lookup
    }
  }

  return FREQUENCY_MULTIPLIERS[frequency] || 1
}

/**
 * Format frequency for human-readable display
 */
export function formatFrequency(frequency: string, daysOfWeek?: string, monthlyPattern?: string): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  
  let days = ''
  if (daysOfWeek) {
    try {
      const dayIndices = JSON.parse(daysOfWeek)
      if (Array.isArray(dayIndices) && dayIndices.length > 0) {
        days = dayIndices.map((i: number) => dayNames[i]).join(', ')
      }
    } catch {
      // Ignore
    }
  }

  // Helper to format ordinal
  const formatWeekOrdinal = (w: number | 'last' | string) => {
    if (w === 'last') return 'Last'
    if (w === 1) return '1st'
    if (w === 2) return '2nd'
    if (w === 3) return '3rd'
    return `${w}th`
  }
  
  // Format MONTHLY with NTH_WEEKDAY pattern
  if (frequency === 'MONTHLY' && monthlyPattern) {
    try {
      const pattern = JSON.parse(monthlyPattern)
      if (pattern.type === 'NTH_WEEKDAY') {
        const weekStr = pattern.weeks.map(formatWeekOrdinal).join(' & ')
        return `Monthly: ${weekStr} ${fullDayNames[pattern.weekday]}`
      }
    } catch {
      // Fall through to default
    }
  }
  
  // Format 2X_MONTHLY with pattern details
  if (frequency === '2X_MONTHLY' && monthlyPattern) {
    try {
      const pattern = JSON.parse(monthlyPattern)
      if (pattern.type === 'FIXED_DATES') {
        const formatDate = (d: number) => d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : `${d}th`
        return `2x Monthly: ${formatDate(pattern.dates[0])} & ${formatDate(pattern.dates[1])}`
      } else if (pattern.type === 'NTH_WEEKDAY') {
        const weekStr = pattern.weeks.map(formatWeekOrdinal).join(' & ')
        return `2x Monthly: ${weekStr} ${fullDayNames[pattern.weekday]}`
      }
    } catch {
      // Fall through to default
    }
  }
  
  const freqMap: Record<string, string> = {
    'DAILY': 'Daily (7x/week)',
    'WEEKLY': '1x Weekly',
    'BI_WEEKLY': 'Bi-Weekly',
    'MONTHLY': '1x Monthly',
    'EVERY_2_WEEKS': 'Every 2 Weeks',
    'EVERY_3_WEEKS': 'Every 3 Weeks',
    'EVERY_4_WEEKS': 'Every 4 Weeks',
    'EVERY_6_WEEKS': 'Every 6 Weeks',
    '2X_WEEKLY': '2x Weekly',
    '3X_WEEKLY': '3x Weekly',
    '4X_WEEKLY': '4x Weekly',
    '5X_WEEKLY': '5x Weekly',
    '2X_MONTHLY': '2x Monthly',
    '3X_MONTHLY': '3x Monthly',
  }
  
  const base = freqMap[frequency] || frequency
  
  if (days) {
    return `${base}: ${days}`
  }
  
  return base
}

/**
 * Format pay type for display
 */
export function formatPayType(payType: string): string {
  if (payType === 'FLAT_RATE') return 'Monthly Flat'
  if (payType === 'PER_CLEAN') return 'Per Clean'
  return payType
}
