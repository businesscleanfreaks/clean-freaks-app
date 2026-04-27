import { CleanerDetailClient } from "@/components/subcontractors/cleaner-detail-client"

export default async function CleanerDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string }
}) {
  const resolvedParams = await Promise.resolve(params)
  return <CleanerDetailClient id={resolvedParams.id} />
}
