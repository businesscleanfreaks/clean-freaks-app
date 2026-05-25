"use client"

import { useState } from "react"
import { formatCurrency } from "@/lib/utils"
import {
  AlertTriangle,
  ChevronDown,
  MailX,
} from "lucide-react"
import Link from "next/link"

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

interface CandidateCardProps {
  candidate: InvoiceCandidate
  onReview: (candidate: InvoiceCandidate) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (candidateId: string) => void
  canSelectNonActionable?: boolean
}

function getExceptionLabel(exception: InvoiceCandidate['exceptions'][number]) {
  if (exception.type === 'SKIPPED') return exception.message.replace('clean was skipped', 'skipped')
  if (exception.type === 'MISSING_EMAIL') return 'No email on file'

  if (exception.type === 'PRICE_CHANGE') {
    const match = exception.message.match(/Rate override on (.*?): \$(.*?) vs schedule \$(.*)/)
    if (match) return `${match[1]}: Billed $${match[2]} instead of regular $${match[3]}.`
  }

  return exception.message
}

function getLineItemLabel(item: InvoiceCandidate['lineItems'][number]) {
  if (item.sourceType === 'ADD_ON' || item.sourceType === 'RECURRING_ADD_ON') {
    return item.locationName ? `${item.description} - ${item.locationName}` : item.description
  }
  return item.description
}

export function CandidateCard({ candidate, onReview, selectable, selected, onToggleSelect, canSelectNonActionable }: CandidateCardProps) {
  const [expanded, setExpanded] = useState(false)
  const hasExceptions = candidate.exceptions.length > 0
  const isActionable = candidate.status === 'READY' || candidate.status === 'NEEDS_ATTENTION'
  const hasExisting = !!candidate.existingInvoiceId
  const isFlatRate = candidate.billingType === 'FLAT_RATE'
  const isPerClean = !isFlatRate
  const showNoChanges = isFlatRate && isActionable && !hasExceptions
  const visibleExceptions = candidate.exceptions.slice(0, 2)
  const statusSummary = candidate.scheduleSummary
  const canExpand = isPerClean && candidate.lineItems.length > 0
  const existingStatusLabel = candidate.existingInvoiceStatus === 'DRAFT'
    ? 'Draft exists'
    : candidate.existingInvoiceStatus === 'MARKED_INVOICED'
      ? 'Marked invoiced'
    : candidate.existingInvoiceStatus === 'SENT'
      ? 'Sent'
      : candidate.existingInvoiceStatus === 'PAID'
        ? 'Paid'
        : 'Already invoiced'
  const showSelectionCheckbox = selectable && (isActionable || canSelectNonActionable)

  return (
    <div
      style={{
        backgroundColor: selected ? 'rgba(0,168,150,0.06)' : 'white',
        borderBottom: '1px solid #F1F5F9',
        transition: 'background-color 120ms',
      }}
      onMouseEnter={e => {
        if (isActionable && !selected) e.currentTarget.style.backgroundColor = '#FAFAFA'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = selected ? 'rgba(0,168,150,0.06)' : 'white'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px',
          cursor: isActionable ? 'pointer' : 'default',
        }}
        onClick={() => isActionable && onReview(candidate)}
      >
        {showSelectionCheckbox && (
          <button
            type="button"
            aria-label={selected ? 'Deselect invoice' : 'Select invoice'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.(candidate.candidateId)
            }}
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '5px',
              flexShrink: 0,
              border: selected ? '2px solid #00A896' : '2px solid #D1D5DB',
              backgroundColor: selected ? '#00A896' : 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 120ms',
            }}
          >
            {selected && <span style={{ color: 'white', fontSize: '12px', lineHeight: 1, fontWeight: 700 }}>✓</span>}
          </button>
        )}

        {canExpand && (
          <button
            type="button"
            aria-label={expanded ? 'Collapse invoice details' : 'Expand invoice details'}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(current => !current)
            }}
            style={{
              width: '18px',
              height: '18px',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ChevronDown
              style={{
                width: '15px',
                height: '15px',
                color: '#94A3B8',
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 120ms',
              }}
            />
          </button>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 800,
                color: '#111111',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {candidate.clientName}
            </span>
            {!candidate.hasEmail && (
              <span title="No email on file" style={{ flexShrink: 0, display: 'flex' }}>
                <MailX style={{ width: '14px', height: '14px', color: '#F59E0B' }} />
              </span>
            )}
          </div>

          <div
            style={{
              fontSize: '11px',
              color: '#7C8798',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
            }}
          >
            {statusSummary && <span>{statusSummary}</span>}
            {showNoChanges && (
              <>
                {statusSummary && <span style={{ color: '#CBD5E1' }}>·</span>}
                <span style={{ color: '#047857', fontWeight: 700 }}>No changes ✓</span>
              </>
            )}
            {!isActionable && hasExisting && (
              <>
                {statusSummary && <span style={{ color: '#CBD5E1' }}>·</span>}
                <span style={{ color: '#64748B', fontWeight: 600 }}>{existingStatusLabel}</span>
              </>
            )}
          </div>

          {hasExceptions && isActionable && (
            <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
              {visibleExceptions.map((ex, idx) => (
                <span
                  key={`${ex.type}-${idx}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: '#92400E',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  <AlertTriangle style={{ width: '11px', height: '11px' }} />
                  {getExceptionLabel(ex)}
                </span>
              ))}
              {candidate.exceptions.length > visibleExceptions.length && (
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#92400E' }}>
                  +{candidate.exceptions.length - visibleExceptions.length} more
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '92px' }}>
          <span style={{ fontSize: '16px', fontWeight: 800, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(candidate.total)}
          </span>
        </div>

        {hasExisting ? (
          <Link
            href={`/invoices/${candidate.existingInvoiceId}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '4px 0',
              fontSize: '12px',
              fontWeight: 600,
              color: '#0F766E',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            Open
          </Link>
        ) : null}
      </div>

      {expanded && canExpand && (
        <div style={{ padding: '0 12px 10px 58px' }}>
          <div style={{ borderTop: '1px solid #F1F5F9' }}>
            {candidate.lineItems.map((item, index) => (
              <div
                key={`${item.sourceType}-${item.sourceId || item.jobId || index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '7px 0',
                  borderBottom: index === candidate.lineItems.length - 1 ? 'none' : '1px solid #F8FAFC',
                }}
              >
                <span style={{ minWidth: 0, fontSize: '12px', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {getLineItemLabel(item)}
                </span>
                <span style={{ flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(item.price)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
