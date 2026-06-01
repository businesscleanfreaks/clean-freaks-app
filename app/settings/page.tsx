import { requireAuth } from "@/lib/auth"
import { EmailSettingsForm } from "@/components/settings/email-settings-form"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  await requireAuth()
  return <EmailSettingsForm />
}
