import { ClientDetailClient } from "@/components/clients/client-detail-client"

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const resolvedParams = await Promise.resolve(params)
  return <ClientDetailClient clientId={resolvedParams.id} />
}
