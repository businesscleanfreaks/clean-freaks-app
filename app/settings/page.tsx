import { requireAuth } from "@/lib/auth"
import { getBusinessProfile } from "@/lib/business-settings"
import { SettingsShell } from "@/components/settings/settings-shell"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  await requireAuth()
  const business = await getBusinessProfile()
  return <SettingsShell initialBusiness={business} />
}
