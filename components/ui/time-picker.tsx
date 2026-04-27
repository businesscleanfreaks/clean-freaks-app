"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  required?: boolean
  id?: string
}

// Generate time options in 15-minute intervals
function generateTimeOptions() {
  const times: string[] = []
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const hourStr = hour.toString().padStart(2, '0')
      const minuteStr = minute.toString().padStart(2, '0')
      const time24 = `${hourStr}:${minuteStr}`

      // Format for display (12-hour with AM/PM)
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
      const ampm = hour < 12 ? 'AM' : 'PM'
      const display = `${hour12}:${minuteStr} ${ampm}`

      times.push(time24)
    }
  }
  return times
}

// Format time for display
function formatTimeDisplay(time24: string): string {
  if (!time24) return ''
  const [hourStr, minuteStr] = time24.split(':')
  const hour = parseInt(hourStr)
  const minute = minuteStr || '00'
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const ampm = hour < 12 ? 'AM' : 'PM'
  return `${hour12}:${minute} ${ampm}`
}

export function TimePicker({ value, onChange, required, id }: TimePickerProps) {
  const timeOptions = generateTimeOptions()

  return (
    <Select value={value} onValueChange={onChange} required={required}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select time">
          {value ? formatTimeDisplay(value) : 'Select time'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        {timeOptions.map((time) => (
          <SelectItem key={time} value={time}>
            {formatTimeDisplay(time)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
