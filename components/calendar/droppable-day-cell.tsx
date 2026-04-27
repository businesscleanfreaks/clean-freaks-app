"use client"

import { useDroppable } from '@dnd-kit/core'
import { format } from 'date-fns'
import { ReactNode } from 'react'

interface DroppableDayCellProps {
  id: string
  date: Date
  children: ReactNode
  onClick: (e: React.MouseEvent) => void
  isToday: boolean
  isCurrentMonth: boolean
}

export function DroppableDayCell({
  id,
  date,
  children,
  onClick,
  isToday,
  isCurrentMonth,
}: DroppableDayCellProps) {
  const { setNodeRef, isOver, active } = useDroppable({
    id,
    data: {
      date,
      type: 'day-cell',
    },
  })

  const isValidDrop = isOver && active?.data.current?.job

  return (
    <div
      ref={setNodeRef}
      className={`
        h-[85px] p-1.5 border-r border-b border-gray-100 cursor-pointer 
        transition-all duration-200 ease-out relative group
        ${!isCurrentMonth ? 'bg-gray-50/50' : 'bg-white'}
        ${isToday ? 'bg-teal-50 ring-2 ring-teal-500 ring-inset z-10' : ''}
        hover:z-20 hover:scale-[1.03] hover:-translate-y-0.5
        hover:shadow-xl hover:shadow-teal-500/20
        hover:border-teal-400 hover:bg-gradient-to-b hover:from-white hover:to-teal-50/50
        hover:ring-2 hover:ring-teal-400/50
        ${isValidDrop ? 'ring-2 ring-teal-500 bg-teal-50' : ''}
      `}
      style={{
        backgroundColor: isValidDrop ? 'rgba(20, 184, 166, 0.1)' : undefined,
        borderColor: isValidDrop ? 'rgba(20, 184, 166, 0.5)' : undefined,
      }}
      onClick={onClick}
    >
      {children}
      {/* Drag feedback overlay */}
      {isValidDrop && (
        <div
          className="absolute inset-0 bg-teal-500/20 border-2 border-teal-500 rounded flex items-center justify-center pointer-events-none z-50 animate-in"
        >
          <div className="bg-teal-600 text-white px-3 py-1.5 rounded-lg shadow-lg text-sm font-bold">
            {format(date, 'MMM d')}
          </div>
        </div>
      )}
    </div>
  )
}

