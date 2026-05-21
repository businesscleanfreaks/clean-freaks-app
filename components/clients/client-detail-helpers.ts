import { formatDateOnly } from "@/lib/date-only"
import { getAverageScheduleOccurrencesPerMonth } from "@/lib/schedule-averages"
import { getScheduleLifecycle } from "@/lib/schedule-timing"
import type { ClientSchedule } from "./client-detail-types"

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export const QUICK_ADD_SERVICES = [
  { icon: '🪟', label: 'Windows' },
  { icon: '🧊', label: 'Fridge' },
  { icon: '🍳', label: 'Oven' },
  { icon: '🧹', label: 'Deep' },
]

export function getAverageMonthlyScheduleOccurrences(schedule: ClientSchedule) {
  return getAverageScheduleOccurrencesPerMonth({
    frequency: schedule.frequency,
    startDate: schedule.startDate,
    endDate: schedule.endDate ?? null,
    daysOfWeek: schedule.daysOfWeek || null,
    monthlyPattern: schedule.monthlyPattern || null,
    customDates: schedule.customDates || null,
    excludedDates: schedule.excludedDates || null,
  })
}

export function parseScheduleDays(daysOfWeek?: string | null): number[] {
  if (!daysOfWeek) return []
  try {
    const parsed = JSON.parse(daysOfWeek)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function getScheduleFrequencyLabel(frequency?: string | null) {
  switch (frequency) {
    case 'WEEKLY':
      return 'Weekly'
    case 'BI_WEEKLY':
      return 'Bi-Weekly'
    case 'EVERY_3_WEEKS':
      return 'Every 3 Weeks'
    case 'EVERY_4_WEEKS':
      return 'Every 4 Weeks'
    case 'EVERY_6_WEEKS':
      return 'Every 6 Weeks'
    case 'MONTHLY':
      return 'Monthly'
    case '2X_MONTHLY':
      return '2x Monthly'
    case 'CUSTOM':
      return 'Custom'
    default:
      return frequency || 'Schedule'
  }
}

export function getScheduleTimingBadge(schedule: ClientSchedule) {
  const lifecycle = getScheduleLifecycle(schedule)

  if (lifecycle === 'upcoming') {
    return {
      label: `Starts ${formatDateOnly(schedule.startDate, 'MMM d') || ''}`,
      className: 'bg-blue-50 text-blue-700 border border-blue-200',
    }
  }

  if (lifecycle === 'ended') {
    return {
      label: `Ended ${schedule.endDate ? formatDateOnly(schedule.endDate, 'MMM d') : 'earlier'}`,
      className: 'bg-stone-100 text-stone-500 border border-stone-200',
    }
  }

  return {
    label: 'Current',
    className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  }
}

export function formatScheduleDate(value?: Date | string | null) {
  if (!value) return null
  return formatDateOnly(value)
}

export function getScheduleHistoryLine(schedule: ClientSchedule) {
  const lifecycle = getScheduleLifecycle(schedule)
  const start = formatScheduleDate(schedule.startDate)
  const end = formatScheduleDate(schedule.endDate)

  if (lifecycle === 'upcoming') {
    if (start && end) return `Starts ${start} and runs until ${end}`
    if (start) return `Starts ${start}`
    return 'Starts later'
  }

  if (lifecycle === 'ended') {
    if (start && end) return `Was active ${start} to ${end}`
    if (end) return `Ended ${end}`
    if (start) return `Started ${start}`
    return 'Past schedule'
  }

  if (start && end) return `Active ${start} to ${end}`
  if (start) return `Active since ${start}`
  if (end) return `Active until ${end}`
  return 'Current schedule'
}

export function getScheduleHistoryOverview(schedules: ClientSchedule[]) {
  if (schedules.length <= 1) return null

  const counts = schedules.reduce(
    (acc, schedule) => {
      const lifecycle = getScheduleLifecycle(schedule)
      acc[lifecycle] += 1
      return acc
    },
    { current: 0, upcoming: 0, ended: 0 }
  )

  const parts: string[] = []
  if (counts.ended > 0) {
    parts.push(`${counts.ended} past`)
  }
  if (counts.upcoming > 0) {
    parts.push(`${counts.upcoming} upcoming`)
  }

  if (parts.length === 0) {
    return `${schedules.length} schedule versions on file`
  }

  return `${schedules.length} schedule versions • ${parts.join(' • ')}`
}

export function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}
