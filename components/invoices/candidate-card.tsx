"use client"

import { formatCurrency } from "@/lib/utils"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  MailX,
  ArrowRight,
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

const statusConfig: Record<InvoiceCandidate['status'], {
  dot: string
  bg: string
  border: string
}> = {
  READY: { dot: '#00A896', bg: 'rgba(0,168,150,0.04)', border: '#E8F5F3' },
  NEEDS_ATTENTION: { dot: '#F59E0B', bg: 'rgba(245,158,11,0.04)', border: '#FEF3C7' },
  DRAFT_EXISTS: { dot: '#6B7280', bg: 'rgba(107,114,128,0.03)', border: '#E5E7EB' },
  SENT: { dot: '#3B82F6', bg: 'rgba(59,130,246,0.03)', border: '#DBEAFE' },
  PAID: { dot: '#10B981', bg: 'rgba(16,185,129,0.03)', border: '#D1FAE5' },
}

function getCleanSummary(candidate: InvoiceCandidate) {
  if (candidate.jobCount === 0) return ''
  const scheduled = Math.max(candidate.jobCount - candidate.completedCount, 0)
  const cleanLabel = `${candidate.jobCount} clean${candidate.jobCount !== 1 ? 's' : ''}`
  return `${cleanLabel} · ${candidate.completedCount} done, ${scheduled} scheduled`
}

function getExceptionLabel(exception: InvoiceCandidate['exceptions'][number]) {
  if (exception.type === 'SKIPPED') return exception.message.replace('clean was skipped', 'skipped clean')
  if (exception.type === 'MISSING_EMAIL') return 'No email on file'
  return exception.message
}

export function CandidateCard({ candidate, onReview, selectable, selected, onToggleSelect }: CandidateCardProps) {
  const config = statusConfig[candidate.status]
  const hasExceptions = candidate.exceptions.length > 0
  const isActionable = candidate.status === 'READY' || candidate.status === 'NEEDS_ATTENTION'
  const hasExisting = !!candidate.existingInvoiceId
  const isFlatRate = candidate.billingType === 'FLAT_RATE'
  const showNoChanges = isFlatRate && isActionable && !hasExceptions
  const cleanSummary = getCleanSummary(candidate)
  const visibleExceptions = candidate.exceptions.slice(0, 2)

  return (
    <div
      style={{
        backgroundColor: selected ? 'rgba(0,168,150,0.06)' : config.bg,
        border: `1px solid ${selected ? 'rgba(0,168,150,0.3)' : config.border}`,
        borderRadius: '12px',
        overflow: 'hidden',
        transition: 'box-shadow 150ms, border-color 150ms',
      }}
      onMouseEnter={e => {
        if (isActionable) e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: isFlatRate && isActionable ? '12px 14px' : '14px 16px',
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
              width: '20px', height: '20px', borderRadius: '6px', flexShrink: 0,
              border: selected ? '2px solid #00A896' : '2px solid #D1D5DB',
              backgroundColor: selected ? '#00A896' : 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 120ms',
            }}
          >
            {selected && <span style={{ color: 'white', fontSize: '12px', lineHeight: 1, fontWeight: 700 }}>✓</span>}
          </div>
        )}

        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: config.dot,
            flexShrink: 0,
          }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <span style={{
              fontSize: '15px', fontWeight: 600, color: '#111111',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {candidate.clientName}
            </span>
            {!candidate.hasEmail && (
              <span title="No email on file" style={{ flexShrink: 0, display: 'flex' }}>
                <MailX style={{ width: '14px', height: '14px', color: '#F59E0B' }} />
              </span>
            )}
          </div>

          <div style={{
            fontSize: '12px', color: '#777777',
            display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
          }}>
            <span style={{
              padding: '1px 6px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 500,
              backgroundColor: isFlatRate ? '#EEF2FF' : '#F0FDF4',
              color: isFlatRate ? '#4F46E5' : '#15803D',
            }}>
              {isFlatRate ? 'Flat rate' : 'Per clean'}
            </span>
            {candidate.scheduleSummary && (
              <>
                <span style={{ color: '#DDDDDD' }}>·</span>
                <span>{candidate.scheduleSummary}</span>
              </>
            )}
            {cleanSummary && (
              <>
                <span style={{ color: '#DDDDDD' }}>·</span>
                <span>{cleanSummary}</span>
              </>
            )}
            {showNoChanges && (
              <>
                <span style={{ color: '#DDDDDD' }}>·</span>
                <span style={{ color: '#047857', fontWeight: 600 }}>No changes ✓</span>
              </>
            )}
          </div>

          {hasExceptions && isActionable && (
            <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {visibleExceptions.map((ex, idx) => (
                <span
                  key={`${ex.type}-${idx}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 7px',
                    borderRadius: '999px',
                    backgroundColor: '#FEF3C7',
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

        {showNoChanges && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '4px 10px', borderRadius: '16px',
            backgroundColor: '#D1FAE5',
            fontSize: '12px', fontWeight: 600, color: '#047857',
            flexShrink: 0,
          }}>
            <CheckCircle2 style={{ width: '12px', height: '12px' }} />
            No changes
          </div>
        )}

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#111111' }}>
            {formatCurrency(candidate.total)}
          </span>
        </div>

        {isActionable ? (
          isFlatRate ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '5px 12px',
                fontSize: '12px', fontWeight: 600,
                color: '#00A896',
                backgroundColor: 'rgba(0,168,150,0.08)',
                border: '1px solid rgba(0,168,150,0.2)',
                borderRadius: '8px',
                flexShrink: 0,
                transition: 'background-color 120ms',
              }}
            >
              Invoice
              <ArrowRight style={{ width: '12px', height: '12px' }} />
            </div>
          ) : (
            <ChevronRight style={{ width: '16px', height: '16px', color: '#CCCCCC', flexShrink: 0 }} />
          )
        ) : hasExisting ? (
          <Link
            href={`/invoices/${candidate.existingInvoiceId}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '4px 10px',
              fontSize: '12px', fontWeight: 500,
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
