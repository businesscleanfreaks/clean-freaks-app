"use client"

import { formatCurrency } from "@/lib/utils"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  MailX,
} from "lucide-react"
import Link from "next/link"

export interface InvoiceCandidate {
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
}

interface CandidateCardProps {
  candidate: InvoiceCandidate
  onReview: (candidate: InvoiceCandidate) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (clientId: string) => void
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

export function CandidateCard({ candidate, onReview, selectable, selected, onToggleSelect }: CandidateCardProps) {
  const hasExceptions = candidate.exceptions.length > 0
  const isActionable = candidate.status === 'READY' || candidate.status === 'NEEDS_ATTENTION'
  const hasExisting = !!candidate.existingInvoiceId
  const isFlatRate = candidate.billingType === 'FLAT_RATE'
  const showNoChanges = isFlatRate && isActionable && !hasExceptions
  const visibleExceptions = candidate.exceptions.slice(0, 2)

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
          gap: '12px',
          padding: '10px 14px',
          cursor: isActionable ? 'pointer' : 'default',
        }}
        onClick={() => isActionable && onReview(candidate)}
      >
        {selectable && (
          <div
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.(candidate.clientId)
            }}
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '6px',
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
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 700,
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
              fontSize: '12px',
              color: '#64748B',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
            }}
          >
            {candidate.scheduleSummary && <span>{candidate.scheduleSummary}</span>}
            {showNoChanges && (
              <>
                {candidate.scheduleSummary && <span style={{ color: '#CBD5E1' }}>·</span>}
                <span style={{ color: '#047857', fontWeight: 700 }}>No changes ✓</span>
              </>
            )}
          </div>

          {hasExceptions && isActionable && (
            <div style={{ marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {visibleExceptions.map((ex, idx) => (
                <span
                  key={`${ex.type}-${idx}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: '#92400E',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  <AlertTriangle style={{ width: '11px', height: '11px' }} />
                  {getExceptionLabel(ex)}
                </span>
              ))}
              {candidate.exceptions.length > visibleExceptions.length && (
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#92400E' }}>
                  +{candidate.exceptions.length - visibleExceptions.length} more
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ fontSize: '15px', fontWeight: 800, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(candidate.total)}
          </span>
        </div>

        {isActionable ? (
          <ChevronRight style={{ width: '16px', height: '16px', color: '#CCCCCC', flexShrink: 0 }} />
        ) : hasExisting ? (
          <Link
            href={`/invoices/${candidate.existingInvoiceId}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 500,
              color: '#00A896',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            {candidate.existingInvoiceStatus === 'DRAFT' && <FileText style={{ width: '12px', height: '12px' }} />}
            {candidate.existingInvoiceStatus === 'SENT' && <Clock style={{ width: '12px', height: '12px' }} />}
            {candidate.existingInvoiceStatus === 'PAID' && <CheckCircle2 style={{ width: '12px', height: '12px' }} />}
            {candidate.existingInvoiceNumber ? `#${candidate.existingInvoiceNumber}` : 'View'}
            <ChevronRight style={{ width: '12px', height: '12px' }} />
          </Link>
        ) : null}
      </div>
    </div>
  )
}
