import { ClientsClient } from "@/components/clients/clients-client"

// This page now loads instantly - all data fetching happens client-side
export default function ClientsPage() {
  return <ClientsClient />
}
