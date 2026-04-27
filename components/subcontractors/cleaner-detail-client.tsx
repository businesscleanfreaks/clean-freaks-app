"use client"

import useSWR from "swr"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"
import { formatCurrency } from "@/lib/utils"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import { ArrowLeft, Phone, Mail, CreditCard, Users, Settings, Clock } from "lucide-react"
import { PaymentBreakdownModal } from "@/components/subcontractors/payment-breakdown-modal"
import { SubcontractorDetail } from "@/components/subcontractors/subcontractor-detail"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { differenceInDays, format } from "date-fns"
import { showError, showSuccess } from "@/lib/toast"
import { CADENCE_LABELS, CADENCE_DESCRIPTIONS } from "@/lib/payment-cadence"
import type { CleanerData } from "@/types"

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error("Failed to fetch")
  return res.json()
})

function getStatusInfo(sub: CleanerData, owed: number) {
  if (owed === 0) return { label: "Paid Up", dotColor: "#0d9488" }
  const lastPayment = sub.payments?.[0]
  if (!lastPayment) return { label: "Never Paid", dotColor: "#9ca3af" }
  const daysSince = differenceInDays(new Date(), new Date(lastPayment.datePaid))
  if (daysSince > 30) return { label: "Overdue", dotColor: "#E53935" }
  if (daysSince > 14) return { label: "Due Soon", dotColor: "#f59e0b" }
  return { label: "Recent", dotColor: "#0d9488" }
}

function DetailSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
        <SkeletonPulse className="h-5 w-24 mb-6" />
        <div className="flex items-center gap-4 mb-6">
          <SkeletonPulse className="w-14 h-14" rounded="full" />
          <div>
            <SkeletonPulse className="h-6 w-40 mb-1" />
            <SkeletonPulse className="h-4 w-28" />
          </div>
        </div>
        <SkeletonPulse className="h-20 w-full mb-4" rounded="xl" />
        <SkeletonPulse className="h-10 w-full mb-4" rounded="lg" />
        <SkeletonPulse className="h-40 w-full" rounded="xl" />
      </div>
    </div>
  )
}

interface CleanerDetailClientProps {
  id: string
}

export function CleanerDetailClient({ id }: CleanerDetailClientProps) {
  const router = useRouter()
  const { data: sub, error, isLoading, mutate } = useSWR<CleanerData>(
    `/api/subcontractors/${id}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000 }
  )
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [cadenceDialogOpen, setCadenceDialogOpen] = useState(false)
  const [cadenceForm, setCadenceForm] = useState({
    paymentCadence: 'IMMEDIATE',
    paymentCadenceNotes: '',
    excludeClientIds: '',
  })
  const [savingCadence, setSavingCadence] = useState(false)

  if (isLoading) return <DetailSkeleton />

  if (error || !sub) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load cleaner</p>
          <button onClick={() => router.back()} className="text-teal-600 hover:underline">
            Go back
          </button>
        </div>
      </div>
    )
  }

  const { hex } = getCleanerColorInfo(sub.name)
  const initials = sub.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
  const status = getStatusInfo(sub, sub.owedAmount)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
        {/* Back nav */}
        <button
          onClick={() => router.push("/subcontractors")}
          className="flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 mb-5 -ml-0.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Cleaners
        </button>

        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
            style={{ backgroundColor: hex }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-xl font-bold text-gray-900 truncate">{sub.name}</h1>
              <span className="flex items-center gap-1 flex-shrink-0">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: status.dotColor }} />
                <span className="text-xs text-gray-500">{status.label}</span>
              </span>
            </div>
            {/* Payment Cadence Badge */}
            {sub.paymentCadence && sub.paymentCadence !== 'IMMEDIATE' && (
              <button
                onClick={() => {
                  setCadenceForm({
                    paymentCadence: sub.paymentCadence || 'IMMEDIATE',
                    paymentCadenceNotes: sub.paymentCadenceNotes || '',
                    excludeClientIds: sub.excludeClientIds || '[]',
                  })
                  setCadenceDialogOpen(true)
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors mb-1"
              >
                <Clock className="w-3 h-3" />
                {CADENCE_LABELS[sub.paymentCadence] || sub.paymentCadence}
              </button>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
              {sub.phone && (
                <a href={`tel:${sub.phone}`} className="flex items-center gap-1 hover:text-teal-600 transition-colors">
                  <Phone className="w-3.5 h-3.5" />
                  {sub.phone}
                </a>
              )}
              {sub.email && (
                <a href={`mailto:${sub.email}`} className="flex items-center gap-1 hover:text-teal-600 transition-colors">
                  <Mail className="w-3.5 h-3.5" />
                  {sub.email}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Team Members */}
        {sub.teamMembers && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-700">Team Members</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {sub.teamMembers.split(',').map((member: string, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-700 border border-teal-100"
                >
                  {member.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Payment Cadence Settings */}
        <button
          onClick={() => {
            setCadenceForm({
              paymentCadence: sub.paymentCadence || 'IMMEDIATE',
              paymentCadenceNotes: sub.paymentCadenceNotes || '',
              excludeClientIds: sub.excludeClientIds || '[]',
            })
            setCadenceDialogOpen(true)
          }}
          className="w-full bg-white rounded-xl border border-gray-200 p-4 mb-6 flex items-center justify-between hover:border-gray-300 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
              <Settings className="w-4 h-4 text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">Payment Timing</p>
              <p className="text-xs text-gray-400">
                {CADENCE_LABELS[sub.paymentCadence || 'IMMEDIATE'] || 'Immediate'}
                {sub.paymentCadenceNotes && ` — ${sub.paymentCadenceNotes}`}
              </p>
            </div>
          </div>
          <span className="text-xs text-teal-600 font-medium">Edit</span>
        </button>

        {/* Balance card */}
        {sub.owedAmount > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-teal-600 p-4 flex items-center justify-between mb-6">
            <div>
              <p className="text-xs text-gray-500 font-medium mb-0.5">Amount Owed</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(sub.owedAmount)}</p>
            </div>
            <Button
              onClick={() => setPayModalOpen(true)}
              className="bg-teal-600 hover:bg-teal-700 text-white h-10 px-5 text-sm font-medium rounded-lg"
            >
              <CreditCard className="w-4 h-4 mr-2" />
              Pay
            </Button>
          </div>
        )}

        {/* Statement & History */}
        <SubcontractorDetail subcontractor={sub} onDataChange={mutate} />
      </div>

      {/* Payment Modal */}
      <PaymentBreakdownModal
        subcontractor={sub}
        jobs={sub.jobs || []}
        open={payModalOpen}
        onOpenChange={setPayModalOpen}
        onPaymentComplete={() => {
          setPayModalOpen(false)
          mutate()
        }}
      />

      {/* Cadence Settings Dialog */}
      <Dialog open={cadenceDialogOpen} onOpenChange={setCadenceDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-700" />
              </div>
              Payment Timing
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-gray-500 font-medium">Cadence</Label>
              <select
                value={cadenceForm.paymentCadence}
                onChange={(e) => setCadenceForm({ ...cadenceForm, paymentCadence: e.target.value })}
                className="mt-1 w-full h-10 px-3 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {Object.entries(CADENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                {CADENCE_DESCRIPTIONS[cadenceForm.paymentCadence] || ''}
              </p>
            </div>

            <div>
              <Label className="text-xs text-gray-500 font-medium">
                Notes <span className="text-gray-300">(optional)</span>
              </Label>
              <Textarea
                value={cadenceForm.paymentCadenceNotes}
                onChange={(e) => setCadenceForm({ ...cadenceForm, paymentCadenceNotes: e.target.value })}
                placeholder="e.g., Pay residential when client pays. Commercial monthly."
                className="mt-1 text-sm rounded-lg min-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCadenceDialogOpen(false)}
              disabled={savingCadence}
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setSavingCadence(true)
                try {
                  const res = await fetch(`/api/subcontractors/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      paymentCadence: cadenceForm.paymentCadence,
                      paymentCadenceNotes: cadenceForm.paymentCadenceNotes || null,
                      excludeClientIds: cadenceForm.excludeClientIds || null,
                    }),
                  })
                  if (!res.ok) throw new Error('Failed to save')
                  showSuccess('Payment timing updated')
                  setCadenceDialogOpen(false)
                  mutate()
                } catch {
                  showError('Failed to save payment timing')
                } finally {
                  setSavingCadence(false)
                }
              }}
              disabled={savingCadence}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
            >
              {savingCadence ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
