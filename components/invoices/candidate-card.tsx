"use client"

import { formatCurrency } from "@/lib/utils"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Mail,
  MailX,
  ArrowRight,
} from "lucide-react"
import { useState } from "react"
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
  label: string
}> = {
  READY: {
    dot: '#00A896',
    bg: 'rgba(0,168,150,0.04)',
    border: '#E8F5F3',
    label: 'Ready to Review',
  },
  NEEDS_ATTENTION: {
    dot: '#F59E0B',
    bg: 'rgba(245,158,11,0.04)',
    border: '#FEF3C7',
    label: 'Needs Attention',
  },
  DRAFT_EXISTS: {
    dot: '#6B7280',
    bg: 'rgba(107,114,128,0.03)',
    border: '#E5E7EB',
    label: 'Draft',
  },
  SENT: {
    dot: '#3B82F6',
    bg: 'rgba(59,130,246,0.03)',
    border: '#DBEAFE',
    label: 'Sent',
  },
  PAID: {
    dot: '#10B981',
    bg: 'rgba(16,185,129,0.03)',
    border: '#D1FAE5',
    label: 'Paid',
  },
}

export function CandidateCard({ candidate, onReview, selectable, selected, onToggleSelect }: CandidateCardProps) {
  const [showExceptions, setShowExceptions] = useState(false)
  const config = statusConfig[candidate.status]
  const hasExceptions = candidate.exceptions.length > 0
  const isActionable = candidate.status === 'READY' || candidate.status === 'NEEDS_ATTENTION'
  const hasExisting = !!candidate.existingInvoiceId
  const isFlatRate = candidate.billingType === 'FLAT_RATE'

  // Per-clean completion info
  const allCompleted = candidate.completedCount > 0 && candidate.completedCount >= candidate.jobCount
  const remaining = candidate.jobCount - candidate.completedCount

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
      {/* Main row */}
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
        {/* Checkbox (when selectable) */}
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

        {/* Status dot */}
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: config.dot,
            flexShrink: 0,
          }}
        />

        {/* Client info */}
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
            {/* Billing type badge */}
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
            {/* For flat-rate: suppress job count (predictable amount). For per-clean: show inline summary */}
            {!isFlatRate && candidate.jobCount > 0 && (
              <>
                <span style={{ color: '#DDDDDD' }}>·</span>
                <span>{candidate.completedCount}/{candidate.jobCount} completed</span>
              </>
            )}
          </div>
        </div>

        {/* Per-clean: Prominent completion badge */}
        {!isFlatRate && isActionable && candidate.jobCount > 0 && (
          <div style={{ flexShrink: 0 }}>
            {allCompleted ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '4px 10px', borderRadius: '16px',
                backgroundColor: '#D1FAE5',
                fontSize: '12px', fontWeight: 600, color: '#047857',
              }}>
                <CheckCircle2 style={{ width: '12px', height: '12px' }} />
                All done
              </div>
            ) : remaining > 0 ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '4px 10px', borderRadius: '16px',
                backgroundColor: '#FEF3C7',
                fontSize: '12px', fontWeight: 600, color: '#92400E',
              }}>
                <Clock style={{ width: '12px', height: '12px' }} />
                {remaining} upcoming
              </div>
            ) : null}
          </div>
        )}

        {/* Exception badge */}
        {hasExceptions && isActionable && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowExceptions(!showExceptions)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '4px 10px',
              fontSize: '12px', fontWeight: 600,
              color: '#92400E',
              backgroundColor: '#FEF3C7',
              border: '1px solid #FDE68A',
              borderRadius: '16px',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'background-color 120ms',
            }}
          >
            <AlertTriangle style={{ width: '12px', height: '12px' }} />
            {candidate.exceptions.length}
            <ChevronDown
              style={{
                width: '12px', height: '12px',
                transform: showExceptions ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 150ms',
              }}
            />
          </button>
        )}

        {/* Amount */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#111111' }}>
            {formatCurrency(candidate.total)}
          </span>
        </div>

        {/* Action / link — flat-rate gets inline "Invoice →" button, per-clean gets chevron */}
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

      {/* Exception details (expanded) */}
      {showExceptions && hasExceptions && (
        <div style={{
          padding: '0 16px 12px 38px',
          borderTop: '1px solid rgba(0,0,0,0.05)',
        }}>
          <div style={{
            marginTop: '10px',
            padding: '10px 12px',
            backgroundColor: '#FFFBEB',
            borderRadius: '8px',
            border: '1px solid #FEF3C7',
          }}>
            <p style={{ fontSize: '12px', fontWeight: 600, color: '#92400E', marginBottom: '6px' }}>
              {candidate.exceptions.length} exception{candidate.exceptions.length !== 1 ? 's' : ''}:
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {candidate.exceptions.map((ex, idx) => (
                <li
                  key={idx}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '6px',
                    fontSize: '12px', color: '#78350F',
                    padding: '2px 0',
                  }}
                >
                  <span style={{ color: '#D97706', flexShrink: 0 }}>•</span>
                  <span>{ex.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
