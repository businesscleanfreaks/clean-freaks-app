"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Trash2, FileText, Download, Eye, Mail, Loader2, RotateCcw, RefreshCw, AlertTriangle, X } from "lucide-react"
import { showInfo } from "@/lib/toast"
import { InvoiceWithRelations } from "@/types"
import { InvoiceStatusBadge } from "./invoice-status-badge"
import { useConfirm } from "@/hooks/use-confirm"
import { showApiError } from "@/lib/toast"
import { Badge } from "@/components/ui/badge"
import { getInvoiceRevisionInfo } from "@/lib/invoice-revision"

interface InvoiceDetailProps {
  invoice: InvoiceWithRelations
  onDataChange?: () => void
}

export function InvoiceDetail({ invoice, onDataChange }: InvoiceDetailProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState(invoice.status)
  const [updating, setUpdating] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [pdfUrl, setPdfUrl] = useState(invoice.pdfUrl)
  const [previewPdfSrc, setPreviewPdfSrc] = useState<string | null>(invoice.pdfUrl)
  const { confirm, ConfirmDialog } = useConfirm()
  const revisionInfo = getInvoiceRevisionInfo(invoice)

  // Handle action=email query param
  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'email') {
      showInfo('Email sending will be available in a future update.')
      window.history.replaceState({}, '', `/invoices/${invoice.id}`)
    }
  }, [searchParams, invoice.id])

  // Auto-generate PDF when preview opens and no PDF exists
  useEffect(() => {
    if (previewOpen && !pdfUrl && !generating) {
      handleGeneratePDF()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger PDF generation when preview opens, not when generating/pdfUrl state changes
  }, [previewOpen])

  useEffect(() => {
    if (!pdfUrl) {
      setPreviewPdfSrc(null)
      return
    }

    if (!pdfUrl.startsWith('data:application/pdf')) {
      setPreviewPdfSrc(pdfUrl)
      return
    }

    try {
      const base64 = pdfUrl.split(',')[1]
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      setPreviewPdfSrc(objectUrl)
      return () => URL.revokeObjectURL(objectUrl)
    } catch {
      setPreviewPdfSrc(pdfUrl)
    }
  }, [pdfUrl])

  const handleStatusChange = async (newStatus: string) => {
    // Confirmation for marking as PAID
    if (newStatus === 'PAID' && status !== 'PAID') {
      const confirmed = await confirm({
        title: "Mark as Paid?",
        description: `Invoice: ${invoice.invoiceNumber}\nClient: ${invoice.client.name}\nAmount: ${formatCurrency(invoice.totalAmount)}\n\nThis will record that you received payment. You can change this later if needed.`,
        confirmText: "Mark as Paid",
        cancelText: "Cancel",
      })
      if (!confirmed) return
    }

    // Confirmation for marking back to DRAFT or SENT
    if ((newStatus === 'DRAFT' || newStatus === 'SENT') && status === 'PAID') {
      const confirmed = await confirm({
        title: "Change from Paid?",
        description: "This will un-mark the invoice as paid. Are you sure?",
        confirmText: "Yes, Change",
        cancelText: "Cancel",
        variant: "destructive",
      })
      if (!confirmed) return
    }

    setUpdating(true)
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

      // Update status optimistically
      setStatus(newStatus as 'DRAFT' | 'SENT' | 'PAID')
      const { showSuccess } = await import('@/lib/toast')
      showSuccess(`Invoice status updated to ${newStatus}`)
      onDataChange?.()
    } catch (error) {
      const { showError } = await import('@/lib/toast')
      showError('Failed to update invoice status. Please try again.')
    } finally {
      setUpdating(false)
    }
  }

  const [deleting, setDeleting] = useState(false)
  const [uninvoicing, setUninvoicing] = useState(false)
  const [resetting, setResetting] = useState(false)
  
  // Check if we're in test mode (show reset buttons) - visible in development, sandbox, or when explicitly enabled
  const isTestMode = typeof window !== 'undefined' && (
    process.env.NODE_ENV === 'development' || 
    process.env.NEXT_PUBLIC_TEST_MODE === 'true' ||
    process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'sandbox'
  )

  const handleUninvoice = async () => {
    const confirmed = await confirm({
      title: "Un-invoice & Return to Ready?",
      description: `Invoice: ${invoice.invoiceNumber}\nClient: ${invoice.client.name}\nAmount: ${formatCurrency(invoice.totalAmount)}\n\nThis will:\n• Delete this draft invoice\n• Return ${invoice.lineItems.length} job(s) to the ready-to-bill list\n• You can create a new invoice later if needed`,
      confirmText: "Yes, Return to Ready",
      cancelText: "Cancel",
      variant: "destructive",
    })

    if (!confirmed) {
      return
    }

    setUninvoicing(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to un-invoice')
        setUninvoicing(false)
        return
      }

      const { showSuccess } = await import('@/lib/toast')
      showSuccess('Jobs returned to ready-to-bill list')
      router.push('/invoices')
    } catch (error) {
      const { showError } = await import('@/lib/toast')
      showError('Failed to un-invoice. Please try again.')
      setUninvoicing(false)
    } finally {
      setUninvoicing(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete Invoice?",
      description: `Invoice: ${invoice.invoiceNumber}\nClient: ${invoice.client.name}\nAmount: ${formatCurrency(invoice.totalAmount)}\nStatus: ${invoice.status}\n\nThis will:\n• Delete this invoice permanently\n• Un-mark ${invoice.lineItems.length} job(s) as invoiced\n• Cannot be undone`,
      confirmText: "Yes, Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })

    if (!confirmed) {
      return
    }

    setDeleting(true)
    try {
      const { logger } = await import('@/lib/logger')
      logger.debug('Deleting invoice:', invoice.id)
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to delete invoice')
        setDeleting(false)
        return
      }

      const { showSuccess } = await import('@/lib/toast')
      showSuccess('Invoice deleted successfully')
      router.push('/invoices')
    } catch (error) {
      const { showError } = await import('@/lib/toast')
      showError('Failed to delete invoice. Please try again.')
      setDeleting(false)
    } finally {
      setDeleting(false)
    }
  }

  const handleGeneratePDF = async () => {
    setGenerating(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/generate-pdf`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to generate PDF')
      }

      const data = await response.json()
      setPdfUrl(data.pdfUrl || data.pdfDataUrl)
      
      const { showSuccess } = await import('@/lib/toast')
      showSuccess('PDF generated successfully!')
    } catch (error) {
      const { logger } = await import('@/lib/logger')
      logger.error('Error generating PDF:', error)
      const { showError } = await import('@/lib/toast')
      showError('Failed to generate PDF. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  // Reset invoice for testing (status reset - back to SENT)
  const handleResetStatus = async () => {
    const confirmed = await confirm({
      title: "Reset Invoice for Testing?",
      description: `This will reset invoice ${invoice.invoiceNumber} from PAID back to SENT status.\n\nYou can then test the payment flow again.\n\n⚠️ This is for testing purposes only.`,
      confirmText: "Reset to SENT",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    setResetting(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'status' }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to reset invoice')
        return
      }

      const data = await response.json()
      const { showSuccess } = await import('@/lib/toast')
      showSuccess(data.message)
      setStatus('SENT')
      onDataChange?.()
    } catch (error) {
      const { showError } = await import('@/lib/toast')
      showError('Failed to reset invoice')
    } finally {
      setResetting(false)
    }
  }

  // Full reset - delete invoice and unmark jobs
  const handleFullReset = async () => {
    const confirmed = await confirm({
      title: "⚠️ Full Reset - Delete Invoice?",
      description: `This will:\n• DELETE invoice ${invoice.invoiceNumber} entirely\n• Return ${invoice.lineItems.length} job(s) to ready-to-bill status\n\nYou can then create a fresh invoice from the client page.\n\n⚠️ This action cannot be undone.`,
      confirmText: "Delete & Reset",
      cancelText: "Cancel",
      variant: "destructive",
    })

    if (!confirmed) return

    setResetting(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'full' }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to reset invoice')
        return
      }

      const data = await response.json()
      const { showSuccess } = await import('@/lib/toast')
      showSuccess(data.message)
      
      // Redirect to client page or invoices
      if (data.redirectTo) {
        router.push(data.redirectTo)
      } else {
        router.push('/invoices')
      }
    } catch (error) {
      const { showError } = await import('@/lib/toast')
      showError('Failed to reset invoice')
    } finally {
      setResetting(false)
    }
  }


  return (
    <>
      <ConfirmDialog />
      <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-primary">{invoice.invoiceNumber}</h1>
            {revisionInfo.isRevised && (
              <Badge variant="outline" className="border-amber-300 text-amber-700">
                Revised
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Created {formatDate(invoice.dateCreated)}
            {revisionInfo.revisedAt ? ` • Revised ${formatDate(revisionInfo.revisedAt)}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-4 w-4 mr-2" />
            Preview PDF
          </Button>
          <Button
            onClick={handleGeneratePDF}
            disabled={generating}
            variant="outline"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            {generating ? 'Generating...' : 'Generate PDF'}
          </Button>
          <Button
            onClick={async () => {
              try {
                // Ensure PDF exists first
                if (!pdfUrl) {
                  const { showError } = await import('@/lib/toast')
                  showError('Please generate a PDF first before sending the email.')
                  return
                }
                const to = invoice.client.invoicingEmail || invoice.client.communicationEmail || ''
                const cc = invoice.client.invoicingCcEmail || ''
                if (!to) {
                  const { showError } = await import('@/lib/toast')
                  showError('No email address found for this client.')
                  return
                }
                setUpdating(true)
                const response = await fetch(`/api/invoices/${invoice.id}/send-email`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    to,
                    subject: `Invoice ${invoice.invoiceNumber} from Clean Freaks`,
                    message: `Please find your invoice ${invoice.invoiceNumber} for ${formatCurrency(invoice.totalAmount)}.`,
                    cc: cc || undefined,
                    isTest: false,
                  }),
                })
                if (response.ok) {
                  const result = await response.json().catch(() => ({}))
                  const { showSuccess, showWarning, showInfo } = await import('@/lib/toast')
                  if (result.safetyMode === 'FORCED_TEST' || result.warning === 'SENDING_DISABLED') {
                    showWarning('Email was NOT sent to the client. Email safety mode is on; configure production email settings to send real invoices.')
                  } else if (result.isTest) {
                    showInfo(`Test email sent to ${result.testEmail || 'your test address'}`)
                  } else {
                    showSuccess('Invoice sent successfully!')
                    setStatus('SENT')
                    onDataChange?.()
                  }
                } else {
                  const { showApiError } = await import('@/lib/toast')
                  await showApiError(response, 'Failed to send invoice email')
                }
              } catch {
                const { showError } = await import('@/lib/toast')
                showError('Failed to send invoice email')
              } finally {
                setUpdating(false)
              }
            }}
            disabled={updating}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Mail className="h-4 w-4 mr-2" />
            Email Invoice
          </Button>
          <Button variant="outline" onClick={() => router.push('/invoices')}>
            Back to Invoices
          </Button>
          {status === 'DRAFT' && (
            <Button
              variant="outline"
              onClick={handleUninvoice}
              disabled={uninvoicing || deleting || updating}
              className="bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-300"
            >
              {uninvoicing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              {uninvoicing ? 'Returning...' : 'Un-invoice & Return to Ready'}
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting || uninvoicing || updating}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      {revisionInfo.isRevised && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">This invoice has been revised</p>
                <p className="text-sm text-amber-800 mt-1">
                  The line items or total changed after the invoice was first created. If you send it again, the client will receive the updated version.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Timeline */}
      <Card className="bg-gradient-to-r from-gray-50 to-white">
        <CardHeader>
          <CardTitle className="text-lg">Invoice Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            {/* DRAFT */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                status === 'DRAFT' ? 'bg-gray-600 text-white' : 'bg-gray-200 text-gray-400'
              }`}>
                {status === 'DRAFT' ? '●' : '○'}
              </div>
              <p className={`text-sm mt-2 font-medium ${status === 'DRAFT' ? 'text-gray-900' : 'text-gray-400'}`}>
                DRAFT
              </p>
              {status === 'DRAFT' && (
                <p className="text-xs text-gray-500 mt-1">Current</p>
              )}
            </div>

            {/* Connection Line DRAFT -> SENT */}
            <div className={`flex-1 h-1 ${status !== 'DRAFT' ? 'bg-teal-500' : 'bg-gray-200'}`} />

            {/* SENT */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                status === 'SENT' ? 'bg-amber-500 text-white' :
                status === 'PAID' ? 'bg-teal-200 text-teal-600' :
                'bg-gray-200 text-gray-400'
              }`}>
                {status === 'SENT' ? '●' : status === 'PAID' ? '✓' : '○'}
              </div>
              <p className={`text-sm mt-2 font-medium ${
                status === 'SENT' ? 'text-amber-700' :
                status === 'PAID' ? 'text-teal-600' :
                'text-gray-400'
              }`}>
                SENT
              </p>
              {status === 'SENT' && (
                <p className="text-xs text-amber-600 mt-1">Current</p>
              )}
              {invoice.dateSent && (
                <p className="text-xs text-gray-500 mt-1">{formatDate(invoice.dateSent)}</p>
              )}
            </div>

            {/* Connection Line SENT -> PAID */}
            <div className={`flex-1 h-1 ${status === 'PAID' ? 'bg-emerald-500' : 'bg-gray-200'}`} />

            {/* PAID */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                status === 'PAID' ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
              }`}>
                {status === 'PAID' ? '✓' : '○'}
              </div>
              <p className={`text-sm mt-2 font-medium ${status === 'PAID' ? 'text-emerald-700' : 'text-gray-400'}`}>
                PAID
              </p>
              {status === 'PAID' && (
                <p className="text-xs text-emerald-600 mt-1">Completed!</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Management - Reset/Undo actions */}
      {(status === 'SENT' || status === 'PAID') && (
        <Card className="border-2 border-dashed border-orange-300 bg-orange-50/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-lg text-orange-700">Undo / Reset Invoice</CardTitle>
            </div>
            <p className="text-sm text-orange-600">
              Use these if you need to fix something or start over with this invoice.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {status === 'PAID' && (
                <Button
                  variant="outline"
                  onClick={handleResetStatus}
                  disabled={resetting}
                  className="border-orange-300 text-orange-700 hover:bg-orange-100"
                >
                  {resetting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Reset to SENT (Undo Payment)
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleFullReset}
                disabled={resetting}
                className="border-red-300 text-red-700 hover:bg-red-100"
              >
                {resetting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete &amp; Return Jobs to Ready
              </Button>
            </div>
            <p className="text-xs text-orange-500 mt-3">
              💡 Reset to SENT: Undo payment so you can re-record it. Delete &amp; Return: Removes the invoice entirely and puts jobs back in the &quot;Need to Invoice&quot; list.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Invoice Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Client</p>
              <p className="font-medium text-lg">{invoice.client.name}</p>
            </div>
            {invoice.client.invoicingEmail && (
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{invoice.client.invoicingEmail}</p>
              </div>
            )}
            {invoice.client.invoicingCcEmail && (
              <div>
                <p className="text-sm text-muted-foreground">CC</p>
                <p className="font-medium">{invoice.client.invoicingCcEmail}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Date Created</p>
              <p className="font-medium">{formatDate(invoice.dateCreated)}</p>
            </div>
            {invoice.dateDue && (
              <div>
                <p className="text-sm text-muted-foreground">Date Due</p>
                <p className="font-medium">{formatDate(invoice.dateDue)}</p>
              </div>
            )}
            {invoice.dateSent && (
              <div>
                <p className="text-sm text-muted-foreground">Last Sent</p>
                <p className="font-medium">{formatDate(invoice.dateSent)}</p>
              </div>
            )}
            {revisionInfo.revisedAt && (
              <div>
                <p className="text-sm text-muted-foreground">Revised On</p>
                <p className="font-medium">{formatDate(revisionInfo.revisedAt)}</p>
              </div>
            )}
            {invoice.notes && (
              <div>
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="font-medium whitespace-pre-wrap">{invoice.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status & Total</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Status</p>
              <Select value={status} onValueChange={handleStatusChange} disabled={updating}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="SENT">Sent</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-1">Total Amount</p>
              <p className="text-3xl font-bold text-primary">{formatCurrency(invoice.totalAmount)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service Date</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lineItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.serviceDate ? formatDate(item.serviceDate) : '-'}</TableCell>
                  <TableCell>{item.job?.location?.name || '-'}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(item.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-6 flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-lg font-semibold border-t pt-2">
                <span>Total:</span>
                <span className="text-primary">{formatCurrency(invoice.totalAmount)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PDF Preview Modal - Beautiful centered design */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent hideClose className="max-w-4xl w-[90vw] h-[90vh] p-0 flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="relative px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white">
            <div className="pr-24">
              <DialogTitle className="text-xl font-bold text-slate-800">
                {invoice.invoiceNumber}
              </DialogTitle>
              <p className="text-sm text-slate-500 mt-0.5">
                {invoice.client.name} • {formatCurrency(invoice.totalAmount)}
              </p>
            </div>
            <div className="absolute top-4 right-4 flex items-center gap-2" style={{ position: 'absolute' }}>
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                >
                  <Download className="h-4 w-4" />
                  Download
                </a>
              )}
              <button
                onClick={() => setPreviewOpen(false)}
                className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                aria-label="Close"
              >
                <X style={{ width: '16px', height: '16px', color: '#6B7280' }} />
              </button>
            </div>
          </div>
          
          {/* PDF Content */}
          <div className="flex-1 overflow-hidden bg-slate-100 p-6">
            {generating ? (
              <div className="h-full flex flex-col items-center justify-center">
                <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
                  <Loader2 className="h-12 w-12 text-teal-600 animate-spin mx-auto mb-4" />
                  <p className="text-lg font-semibold text-slate-800">Generating PDF...</p>
                  <p className="text-sm text-slate-500 mt-2">This usually takes 2-3 seconds</p>
                </div>
              </div>
            ) : previewPdfSrc ? (
              <div className="h-full w-full max-w-3xl mx-auto">
                <iframe
                  src={`${previewPdfSrc}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                  className="w-full h-full rounded-lg shadow-xl bg-white"
                  style={{ border: 'none' }}
                  title="Invoice Preview"
                />
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center">
                <div className="bg-white rounded-2xl shadow-lg p-12 text-center max-w-md">
                  <FileText className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-lg font-semibold text-slate-800 mb-2">No PDF Generated Yet</p>
                  <p className="text-sm text-slate-500 mb-6">
                    Generate a PDF to preview and send this invoice
                  </p>
                  <Button
                    onClick={handleGeneratePDF}
                    className="bg-teal-600 hover:bg-teal-700 text-white px-6"
                    disabled={generating}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Generate PDF
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
    </>
  )
}
