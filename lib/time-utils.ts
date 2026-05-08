/**
 * Shared time utilities for quarter-hour scheduling
 */

/** Generate quarter-hour time options (00, 15, 30, 45) for all 24 hours */
export function generateQuarterHourTimes(): string[] {
  const times: string[] = []
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 15, 30, 45]) {
      times.push(
        `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      )
    }
  }
  return times
}

/** Format 24h time string to 12h display (e.g., "14:30" → "2:30 PM") */
export function formatTimeLabel(time24: string): string {
  if (!time24) return ''
  const [hourStr, minuteStr] = time24.split(':')
  const hour = parseInt(hourStr)
  const minute = minuteStr || '00'
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const ampm = hour < 12 ? 'AM' : 'PM'
  return `${hour12}:${minute} ${ampm}`
}

/** Snap a time value to the nearest quarter-hour */
export function snapToQuarterHour(time: string): string {
  if (!time) return time
  const [hourStr, minuteStr] = time.split(':')
  const hour = parseInt(hourStr)
  const minute = parseInt(minuteStr || '0')
  const snapped = Math.round(minute / 15) * 15
  const finalHour = snapped === 60 ? hour + 1 : hour
  const finalMinute = snapped === 60 ? 0 : snapped
  return `${String(finalHour % 24).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`
}
