import { PayablesWorkspace } from "@/components/payables/payables-workspace"

// Consolidated "what we owe" workspace (cleaners + vendors). Experimental —
// lives alongside the Cleaners and Vendors pages, which stay the system of
// record until this is validated.
export default function PayablesPage() {
  return <PayablesWorkspace />
}
