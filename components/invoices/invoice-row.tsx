"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Trash2 } from "lucide-react"
import { useConfirm } from "@/hooks/use-confirm"
import { showApiError } from "@/lib/toast"

interface InvoiceRowProps {
  invoice: {
    id: string
    invoiceNumber: string
    dateCreated: Date
    totalAmount: number
    status: string
    client: {
      name: string
    }
  }
}

export function InvoiceRow({ invoice }: InvoiceRowProps) {
  const router = useRouter()
  const [status, setStatus] = useState(invoice.status)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === status) return

    setIsUpdatingStatus(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to update status')
        return
      }

      setStatus(newStatus)
      const { showSuccess } = await import('@/lib/toast')
      showSuccess(`Invoice status updated to ${newStatus}`)
      router.refresh()
    } catch (error) {
      const { showError } = await import('@/lib/toast')
      showError('Failed to update invoice status. Please try again.')
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row click when clicking delete

    const confirmed = await confirm({
      title: "Delete Invoice?",
      description: `Are you sure you want to delete invoice ${invoice.invoiceNumber}? This will un-mark the jobs as invoiced and all numbers will adjust accordingly.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })

    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to delete invoice')
        setIsDeleting(false)
        return
      }

      const { showSuccess } = await import('@/lib/toast')
      showSuccess('Invoice deleted successfully. Jobs have been unmarked as invoiced.')
      router.refresh()
    } catch (error) {
      const { showError } = await import('@/lib/toast')
      showError('Failed to delete invoice. Please try again.')
      setIsDeleting(false)
    }
  }

  return (
    <>
      <ConfirmDialog />
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => router.push(`/invoices/${invoice.id}`)}
      >
      <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
      <TableCell>{invoice.client.name}</TableCell>
      <TableCell>{formatDate(invoice.dateCreated)}</TableCell>
      <TableCell>{formatCurrency(invoice.totalAmount)}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Select
          value={status}
          onValueChange={handleStatusChange}
          disabled={isUpdatingStatus}
        >
          <SelectTrigger className="w-[120px] h-8" onClick={(e) => e.stopPropagation()}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SENT">Sent</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={isDeleting}
          className="h-8"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </TableCell>
    </TableRow>
    </>
  )
}
