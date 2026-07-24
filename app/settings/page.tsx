import { requireAuth } from "@/lib/auth"
import { getBusinessProfile } from "@/lib/business-settings"
import { getInvoiceDefaults } from "@/lib/invoice-defaults"
import { SettingsShell } from "@/components/settings/settings-shell"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  await requireAuth()
  const [business, invoiceDefaults] = await Promise.all([getBusinessProfile(), getInvoiceDefaults()])
  return <SettingsShell initialBusiness={business} initialInvoiceDefaults={invoiceDefaults} />
}
