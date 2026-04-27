import { DashboardClient } from "@/components/dashboard/dashboard-client"

// This page now loads instantly - all data fetching happens client-side
export default function DashboardPage() {
  return <DashboardClient />
}
