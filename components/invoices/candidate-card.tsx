"use client"

export interface InvoiceCandidate {
  candidateId: string
  clientId: string
  clientName: string
  billingType: string
  status: 'READY' | 'NEEDS_ATTENTION' | 'DRAFT_EXISTS' | 'SENT' | 'PAID'
  scheduleSummary: string
  lineItems: Array<{
    description: string
    quantity: number
    price: number
    sourceType: 'JOB' | 'ADD_ON' | 'FLAT_RATE' | 'RECURRING_ADD_ON'
    sourceId?: string
    jobId?: string
    scheduleId?: string
    locationName?: string
  }>
  exceptions: Array<{
    type: string
    message: string
  }>
  total: number
  existingInvoiceId?: string
  existingInvoiceNumber?: string
  existingInvoiceStatus?: string
  jobCount: number
  completedCount: number
  hasEmail: boolean
  jobIds: string[]
}

// ── Shared design tokens (match invoices_page (1).jsx reference) ──
export const MO = "'JetBrains Mono', monospace"
export const TEAL = '#0D9488'

export type InvoiceUiStatus = 'Not Sent' | 'Sent' | 'Paid'
export type InvoiceDisplayType = 'Flat Rate' | 'Per Clean' | 'One-Time'

// Card border, left-dot, status-pill bg, and card bg keyed by UI status
export const sBrd: Record<InvoiceUiStatus, string> = { 'Not Sent': '#E2E8F0', Sent: '#93C5FD', Paid: '#86EFAC' }
export const sDot: Record<InvoiceUiStatus, string> = { 'Not Sent': '#D97706', Sent: '#2563EB', Paid: '#16A34A' }
export const sPBg: Record<InvoiceUiStatus, string> = { 'Not Sent': '#FFFBEB', Sent: '#DBEAFE', Paid: '#DCFCE7' }
export const cBg: Record<InvoiceUiStatus, string> = { 'Not Sent': '#fff', Sent: '#F8FAFF', Paid: '#F7FDF9' }
// Billing-cadence color coding for the "Invoiced" metadata column
export const bC: Record<string, string> = { Monthly: '#64748B', Weekly: '#2563EB', 'After Clean': '#D97706' }

// Whole-dollar money used on cards/headers (matches the reference's $c helper)
export function money0(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

interface CandidateCardProps {
  candidate: InvoiceCandidate
  uiStatus: InvoiceUiStatus
  freqLabel: string
  billingLabel: string
  selected: boolean
  selectable: boolean
  active?: boolean
  onOpen: (candidate: InvoiceCandidate) => void
  onToggleSelect: (candidateId: string) => void
  onMarkPaid?: (candidate: InvoiceCandidate) => void
}

export function CandidateCard({
  candidate,
  uiStatus,
  freqLabel,
  billingLabel,
  selected,
  selectable,
  active,
  onOpen,
  onToggleSelect,
  onMarkPaid,
}: CandidateCardProps) {
  const isNotSent = uiStatus === 'Not Sent'
  const showCheckbox = isNotSent && selectable
  const hasFlags = candidate.exceptions.length > 0
  const cleansLabel = candidate.jobCount > 0 ? String(candidate.jobCount) : '—'

  return (
    <div
      onClick={() => onOpen(candidate)}
      style={{
        background: cBg[uiStatus],
        borderRadius: 6,
        border: active ? `2px solid ${TEAL}` : `1px solid ${sBrd[uiStatus]}`,
        borderLeft: `3px solid ${sDot[uiStatus]}`,
        padding: '8px 10px',
        cursor: 'pointer',
        transition: 'box-shadow 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      {/* Row 1: checkbox/dot · client name · flag · amount */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {showCheckbox && (
          <button
            type="button"
            aria-label={selected ? 'Deselect invoice' : 'Select invoice'}
            onClick={e => { e.stopPropagation(); onToggleSelect(candidate.candidateId) }}
            style={{
              all: 'unset',
              width: 14,
              height: 14,
              borderRadius: 3,
              border: selected ? 'none' : '1.5px solid #D0D5DD',
              background: selected ? TEAL : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {selected && (
              <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                <path d="M2.5 6L5 8.5 9.5 3.5" />
              </svg>
            )}
          </button>
        )}
        {!isNotSent && (
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: sDot[uiStatus], flexShrink: 0 }} />
        )}
        {isNotSent && !selectable && (
          <span aria-hidden="true" style={{ width: 14, height: 14, flexShrink: 0 }} />
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            paddingRight: 10,
            fontSize: 12,
            fontWeight: 600,
            color: '#0F172A',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {candidate.clientName}
        </span>
        {hasFlags && (
          <span
            title={candidate.exceptions.map(e => e.message).join('\n')}
            style={{ fontSize: 7, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#FEF2F2', color: '#DC2626', flexShrink: 0 }}
          >
            !
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: MO, color: '#0F172A', flexShrink: 0 }}>
          {money0(candidate.total)}
        </span>
      </div>

      {/* Row 2: Schedule · Invoiced · Cleans · [Paid] · status pill */}
      <div style={{ display: 'flex', gap: 0, marginTop: 5, marginLeft: showCheckbox ? 20 : 14, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 7, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Schedule</div>
          <div style={{ fontSize: 10, color: '#0F172A', fontWeight: 500 }}>{freqLabel}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 7, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Invoiced</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: bC[billingLabel] || '#64748B' }}>{billingLabel}</div>
        </div>
        <div>
          <div style={{ fontSize: 7, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Cleans</div>
          <div style={{ fontSize: 10, color: '#0F172A', fontWeight: 500 }}>{cleansLabel}</div>
        </div>
        <div style={{ marginLeft: 'auto', paddingLeft: 6, display: 'flex', gap: 3, alignItems: 'center' }}>
          {uiStatus === 'Sent' && onMarkPaid && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onMarkPaid(candidate) }}
              style={{ all: 'unset', fontSize: 8, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#16A34A', color: '#fff', cursor: 'pointer' }}
            >
              Paid
            </button>
          )}
          <span style={{ fontSize: 8, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: sPBg[uiStatus], color: sDot[uiStatus] }}>
            {uiStatus}
          </span>
        </div>
      </div>
    </div>
  )
}
