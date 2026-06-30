import { PaymentInbox } from "@/components/payables/payment-inbox"

// Reconciliation inbox: detected client payments awaiting review. Lives under
// Payables since confirming one releases the linked cleaner there.
export default function PaymentsInboxPage() {
  return <PaymentInbox />
}
