import { CalendarClient } from "@/components/calendar/calendar-client"

// This page now loads instantly - all data fetching happens client-side
export default function CalendarPage() {
  return <CalendarClient />
}
