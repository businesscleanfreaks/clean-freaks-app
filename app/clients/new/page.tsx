import { ClientForm } from "@/components/clients/client-form"

export default function NewClientPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-primary mb-8">Add New Client</h1>
      <ClientForm />
    </div>
  )
}
