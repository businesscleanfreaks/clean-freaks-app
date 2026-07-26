import { requireAuth } from "@/lib/auth"
import { getBusinessProfile } from "@/lib/business-settings"
import { getInvoiceDefaults } from "@/lib/invoice-defaults"
import { getPayoutSettings } from "@/lib/payout-settings"
import { getPaymentMethods } from "@/lib/payment-methods"
import { getEmailConfig, getEmailSettingsRow } from "@/lib/email-settings"
import { SettingsShell } from "@/components/settings/settings-shell"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  await requireAuth()
  const [business, invoiceDefaults, payoutSettings, paymentMethods, emailConfig, emailRow] = await Promise.all([
    getBusinessProfile(),
    getInvoiceDefaults(),
    getPayoutSettings(),
    getPaymentMethods(),
    getEmailConfig(),
    getEmailSettingsRow(),
  ])

  return (
    <SettingsShell
      initialBusiness={business}
      initialInvoiceDefaults={invoiceDefaults}
      initialPaymentDetection={{
        enableInboxSync: emailRow?.enableInboxSync ?? false,
        autoConfirmHighConfidencePayments: emailRow?.autoConfirmHighConfidencePayments ?? false,
      }}
      initialPaymentMethods={paymentMethods}
      initialPayoutSettings={payoutSettings}
      emailContext={{
        provider: emailConfig.provider,
        credsSet: !!emailConfig.gmailAppPassword,
      }}
    />
  )
}
