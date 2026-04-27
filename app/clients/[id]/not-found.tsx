import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="p-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-primary mb-4">Client Not Found</h2>
        <p className="text-muted-foreground mb-6">
          The client you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link href="/clients">
          <Button>Back to Clients</Button>
        </Link>
      </div>
    </div>
  )
}
