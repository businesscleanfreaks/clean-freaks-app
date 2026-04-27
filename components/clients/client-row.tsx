"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { TableRow, TableCell } from "@/components/ui/table"
import { GripVertical } from "lucide-react"

interface ClientRowProps {
  client: {
    id: string
    name: string
    phone: string | null
    communicationEmail: string | null
    billingType: string
    isActive?: boolean
    _count: {
      locations: number
    }
  }
  onStatusChange?: (clientId: string, isActive: boolean) => void
}

export function ClientRow({ client, onStatusChange }: ClientRowProps) {
  const router = useRouter()
  const [isDragging, setIsDragging] = useState(false)
  const [didDrag, setDidDrag] = useState(false)
  const isActive = client.isActive !== false

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true)
    setDidDrag(true)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify({
      clientId: client.id,
      currentStatus: isActive
    }))
    // Make the drag image look better
    if (e.dataTransfer.setDragImage) {
      const dragImage = document.createElement('div')
      dragImage.textContent = client.name
      dragImage.style.position = 'absolute'
      dragImage.style.top = '-1000px'
      document.body.appendChild(dragImage)
      e.dataTransfer.setDragImage(dragImage, 0, 0)
      setTimeout(() => document.body.removeChild(dragImage), 0)
    }
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    // Reset didDrag after a short delay to allow click to be ignored
    setTimeout(() => setDidDrag(false), 100)
  }

  const handleClick = () => {
    // Only navigate if we didn't just drag
    if (!didDrag) {
      router.push(`/clients/${client.id}`)
    }
  }

  return (
    <TableRow
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`cursor-pointer hover:bg-muted/50 transition-opacity ${!isActive ? 'opacity-60' : ''} ${isDragging ? 'opacity-50' : ''}`}
      onClick={handleClick}
    >
      <TableCell className="w-8">
        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
      </TableCell>
      <TableCell className="font-medium">{client.name}</TableCell>
      <TableCell>{client.phone || '-'}</TableCell>
      <TableCell>{client.communicationEmail || '-'}</TableCell>
      <TableCell>
        {client.billingType === 'FLAT_RATE' ? 'Flat Rate' : 'Per Clean'}
      </TableCell>
      <TableCell>{client._count.locations}</TableCell>
    </TableRow>
  )
}
