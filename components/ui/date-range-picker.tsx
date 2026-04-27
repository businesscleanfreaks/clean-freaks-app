"use client"

import { Calendar as CalendarIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface DateRangePickerProps {
  startDate: string
  endDate: string
  onStartDateChange: (date: string) => void
  onEndDateChange: (date: string) => void
  className?: string
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  className,
}: DateRangePickerProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center gap-2">
        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
        <Label htmlFor="start-date" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
          From:
        </Label>
        <Input
          id="start-date"
          type="date"
          value={startDate}
          onChange={(e) => {
            onStartDateChange(e.target.value)
            if (e.target.value && endDate && e.target.value > endDate) {
              onEndDateChange(e.target.value)
            }
          }}
          className="h-8 w-32 text-xs"
        />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="end-date" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
          To:
        </Label>
        <Input
          id="end-date"
          type="date"
          value={endDate}
          onChange={(e) => {
            onEndDateChange(e.target.value)
            if (e.target.value && startDate && e.target.value < startDate) {
              onStartDateChange(e.target.value)
            }
          }}
          min={startDate}
          className="h-8 w-32 text-xs"
        />
      </div>
    </div>
  )
}

