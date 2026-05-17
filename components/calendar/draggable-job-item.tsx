"use client"

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { JobWithFullRelations } from '@/types'
import { formatTime } from '@/lib/utils'
import { getJobOutcomeDisplay } from '@/lib/job-outcomes'
import { hasFinalInvoice } from '@/lib/invoice-status'

interface DraggableJobItemProps {
  job: JobWithFullRelations & { notes?: string | null }
  onClick: (e: React.MouseEvent) => void
  isSelected?: boolean
  workerColor: { bg: string; dot: string }
  status: string
  isUnassigned: boolean
}

export function DraggableJobItem({
  job,
  onClick,
  isSelected,
  workerColor,
  status,
  isUnassigned,
}: DraggableJobItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: job.id,
    data: {
      job,
      date: new Date(job.date),
    },
    disabled: hasFinalInvoice(job.invoiceLineItems) || job.subcontractorPaid || job.status === 'CANCELLED',
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.6 : 1,
    scale: isDragging ? '1.02' : '1',
    transition: isDragging ? 'opacity 0.15s ease, scale 0.15s ease' : 'opacity 0.05s ease, scale 0.05s ease',
  }

  const outcome = getJobOutcomeDisplay(job.notes)
  const invoiceLocked = hasFinalInvoice(job.invoiceLineItems)
  const isLocked = invoiceLocked || job.subcontractorPaid
  const lockLabel = invoiceLocked ? 'Invoiced' : job.subcontractorPaid ? 'Paid' : null
  const timeLabel = job.startTime ? formatTime(job.startTime) : null
  const shortClientName = job.location.client.name.split(' ')[0]

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`
        job-item relative overflow-hidden rounded-[10px] border text-[10px]
        px-2 py-1 transition-all duration-150 hover:scale-[1.02]
        flex items-center gap-1.5 truncate shadow-[0_1px_2px_rgba(15,23,42,0.08),0_8px_18px_rgba(15,23,42,0.05)]
        ${isSelected ? 'ring-2 ring-teal-500 ring-offset-1' : ''}
        ${isDragging ? 'z-50 shadow-2xl' : ''}
        ${isLocked ? 'cursor-default opacity-80' : 'cursor-grab active:cursor-grabbing'}
        ${
          status === 'completed' ? 'bg-emerald-50/95 border-emerald-200 text-emerald-900' :
          status === 'cancelled' ? 'bg-stone-100/95 border-stone-200 text-stone-500 line-through cursor-not-allowed' :
          isUnassigned ? 'bg-amber-50/95 border-amber-200 text-amber-900' :
          `${workerColor.bg} border-white/70 text-slate-800`
        }
      `}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-white/35" />
      <span className={`w-1 h-1 rounded-full flex-shrink-0 ${
        status === 'completed' ? 'bg-emerald-500' :
        status === 'cancelled' ? 'bg-stone-400' :
        isUnassigned ? 'bg-amber-500' :
        workerColor.dot
      }`} />
      <span className="truncate font-semibold tracking-[-0.01em]">
        {shortClientName}
      </span>
      {timeLabel && (
        <span className="flex-shrink-0 rounded-full border border-white/70 bg-white/75 px-1.5 py-[1px] text-[8px] font-semibold leading-none text-slate-700 shadow-sm">
          {timeLabel}
        </span>
      )}
      {outcome && (
        <span
          className={`flex-shrink-0 rounded-full px-1.5 py-[1px] text-[8px] font-semibold leading-none shadow-sm ${outcome.badgeClassName}`}
          title={outcome.fullLabel}
        >
          {outcome.shortLabel}
        </span>
      )}
      {lockLabel && (
        <span
          className="flex-shrink-0 rounded-full border border-slate-300/80 bg-slate-100/95 px-1.5 py-[1px] text-[8px] font-semibold leading-none text-slate-700 shadow-sm"
          title={invoiceLocked ? 'This job is on a sent or paid invoice' : 'Cleaner has already been paid for this job'}
        >
          {lockLabel}
        </span>
      )}
    </div>
  )
}
