import { requireAuth } from "@/lib/auth"
import { VendorsPageClient } from "@/components/vendors/vendors-page-client"

export const dynamic = "force-dynamic"

export default async function VendorsPage() {
  await requireAuth()
  return <VendorsPageClient />
}
