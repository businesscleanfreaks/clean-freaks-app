"use client"

import { useEffect, useMemo, useRef } from "react"
import useSWR from "swr"
import { RotateCcw, AlertTriangle } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { buildClientMessage, firstNameOf, payMethodLabel, paysByZelle, resolvePayMethod } from "@/lib/invoice-client-message"
import { useDraftMessage } from "./use-draft-message"
import type { WorkspaceInvoice } from "./use-workspace"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/**
 * "Client will receive" — the recipient line and the exact message that will be
 * sent, editable in place. Edits are shared with the compose window verbatim.
 */
export function ClientWillReceive({ inv, month }: { inv: WorkspaceInvoice; month: string }) {
  // This route returns the whole client profile (locations, schedules, six
  // months of jobs) and takes a beat. Until it lands we show nothing rather
  // than a guess: the greeting and the Zelle paragraph both depend on it, and
  // an editable box that rewrites itself under the reviewer is worse than a
  // brief skeleton.
  const { data: client, error: clientError } = useSWR(`/api/clients/${inv.clientId}`, fetcher)
  const loaded = Boolean(client) || Boolean(clientError)
  const { data: business } = useSWR("/api/settings/business", fetcher)

  const monthName = useMemo(() => MONTHS[Number(month.split("-")[1]) - 1] ?? month, [month])

  const contactName: string | null = client?.invoicingContactName || client?.communicationContactName || null
  const toEmail: string | null = client?.invoicingEmail || client?.communicationEmail || null
  const payMethod: string | null = resolvePayMethod(client?.payMethod, client?.preferredPaymentMethod)
  const zelleEmail: string = business?.paymentEmail || "admin@thecleanfreaks.co"

  const seed = useMemo(
    () => buildClientMessage({
      firstName: firstNameOf(contactName, inv.clientName),
      month: monthName,
      payMethod,
      zelleEmail,
    }),
    [contactName, inv.clientName, monthName, payMethod, zelleEmail],
  )

  const { message, setMessage, resetToTemplate, edited } = useDraftMessage(inv.candidateId, seed)

  // Gmail-style auto-grow: the box shows the whole message, never an inner
  // scrollbar, so nothing the client will read is hidden from the reviewer.
  const boxRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [message])

  return (
    <section className="rounded-[10px] border border-stone-200 bg-white">
      <div className="border-b border-stone-100 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Client will receive</div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
          <span className="text-stone-500">To</span>
          <span className="font-semibold text-stone-900">{contactName || inv.clientName}</span>
          {/* The candidate already knows whether an address exists, so the
              warning is right immediately instead of flashing on every row. */}
          {!inv.hasEmail ? (
            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
              <AlertTriangle className="h-3 w-3" />
              No email on file
            </span>
          ) : toEmail ? (
            <>
              <span className="text-stone-300">·</span>
              <span className="text-stone-600">{toEmail}</span>
            </>
          ) : (
            <span className="h-3 w-40 animate-pulse rounded bg-stone-100" />
          )}
        </div>
        {loaded && !paysByZelle(payMethod) && (
          <div className="mt-1 text-[11px] text-stone-400">
            {payMethod
              ? `Pays by ${payMethodLabel(payMethod)} · Zelle details are left out`
              : "No pay method set · Zelle details are left out"}
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Message</span>
          {edited && (
            <button
              type="button"
              onClick={resetToTemplate}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-400 transition-colors hover:text-stone-700"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to template
            </button>
          )}
        </div>
        {loaded ? (
          <textarea
            ref={boxRef}
            value={message}
            onChange={e => setMessage(e.target.value)}
            spellCheck
            className="w-full resize-none overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-stone-800 outline-none transition-colors focus:border-stone-400 focus:bg-white"
          />
        ) : (
          <div className="space-y-2 rounded-lg border border-dashed border-stone-200 bg-stone-50/60 px-3 py-2.5">
            {[5, 4, 3].map((w, i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-stone-100" style={{ width: `${w * 18}%` }} />
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-stone-400">
          This is exactly what goes in the email. Edits carry into the compose window.
        </p>
      </div>
    </section>
  )
}
