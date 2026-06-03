"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { formatCurrency } from "@/lib/utils"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  AlertCircle,
  ExternalLink,
  Mail,
  Plus,
  Save,
  Send,
  SkipForward,
  TestTube,
  Trash2,
  X,
} from "lucide-react"
import { ActionSpinner } from "@/components/ui/action-spinner"
import { ProgressBar } from "@/components/ui/progress-bar"
import { useQuickInvoice, type QuickInvoiceClient, type QuickInvoiceJob } from "./use-quick-invoice"

interface QuickInvoiceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: QuickInvoiceClient
  jobs: QuickInvoiceJob[]
  initialMonth?: string
  onSuccess?: () => void
  onNext?: () => void
  onPrevious?: () => void
  currentIndex?: number
  totalCount?: number
  batchMode?: boolean
}

export function QuickInvoiceModal(props: QuickInvoiceModalProps) {
  const {
    onOpenChange,
    client,
    jobs,
    onNext,
    onPrevious,
    currentIndex,
    totalCount,
    batchMode,
    isCreating,
    isSendingTest,
    isGeneratingPreview,
    previewPdfUrl,
    previewError,
    dateDue,
    notes,
    setNotes,
    lineItems,
    progress,
    progressStep,
    emailCc,
    setEmailCc,
    recipientPool,
    selectedRecipients,
    manualEmailInput,
    setManualEmailInput,
    toggleRecipient,
    addManualRecipient,
    emailSubject,
    setEmailSubject,
    emailMessage,
    setEmailMessage,
    showPaymentOptions,
    setShowPaymentOptions,
    showSendConfirmation,
    setShowSendConfirmation,
    flatRateData,
    totalAmount,
    startEditing,
    saveEdit,
    updateLineItem,
    removeLineItem,
    addLineItem,
    handleCreateInvoice,
    handleSendToClient,
    handleConfirmSendToClient,
    handleGeneratePreview,
    handleBatchApprove,
    handleBatchSkip,
  } = useQuickInvoice(props)

  // v5 alignment: email form fields are visible by default in the split-panel modal so the VA
  // sees To / CC / Subject / Message without an extra click. Still collapsible for tighter view.
  const [emailExpanded, setEmailExpanded] = useState(true)
  const [editingLineItems, setEditingLineItems] = useState(false)

  const invoiceType = client.billingType === 'FLAT_RATE' ? 'Flat Rate' : 'Per Clean'
  const invoiceSubtitle = client.billingType === 'FLAT_RATE'
    ? `${invoiceType} - ${formatCurrency(flatRateData?.monthlyRate ?? totalAmount)}/mo`
    : `${invoiceType} - ${jobs.length} job${jobs.length !== 1 ? 's' : ''}`
  const recipientSummary = selectedRecipients.length > 0 ? selectedRecipients.join(', ') : 'No recipient selected'
  const canSubmit = lineItems.length > 0 && !isCreating && !isSendingTest

  return (
    <Dialog open={props.open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="h-[min(95vh,960px)] w-[min(97vw,1280px)] max-w-none rounded-xl border border-stone-200 bg-stone-50 p-0 gap-0 flex flex-col overflow-hidden shadow-2xl"
      >
        <DialogTitle className="sr-only">Invoice review for {client.name}</DialogTitle>
        <DialogDescription className="sr-only">
          Review invoice line items, email settings, and generated invoice preview before saving or sending.
        </DialogDescription>
        <div className="flex items-center justify-between border-b-2 border-stone-900 bg-white px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {onPrevious ? (
              <button
                onClick={onPrevious}
                className="text-xl leading-none text-stone-500 hover:text-stone-900"
                aria-label="Previous client"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : null}
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold tracking-[-0.02em] text-stone-900">
                {client.name}
              </h2>
              <p className="truncate text-xs text-stone-500">
                {invoiceSubtitle}
                {totalCount != null && totalCount > 1 ? ` - ${(currentIndex ?? 0) + 1} of ${totalCount}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-xl font-bold tracking-[-0.04em] text-stone-900">
              {formatCurrency(totalAmount)}
            </span>
            {onNext ? (
              <button
                onClick={onNext}
                className="text-xl leading-none text-stone-500 hover:text-stone-900"
                aria-label="Next client"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : null}
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Split-panel body: left = email + line items + form, right = invoice preview.
            Each side scrolls independently. Footer stays at the bottom full-width. */}
        <div className="flex min-h-0 flex-1 lg:flex-row flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-r border-stone-200 bg-stone-50 lg:max-w-[540px]">
        <div className="border-b border-stone-200 bg-white px-5 py-2">
          <button
            type="button"
            onClick={() => setEmailExpanded((value) => !value)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="min-w-0 truncate text-xs text-stone-500">
              To: <span className="font-medium text-stone-900">{recipientSummary}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-[11px] font-medium text-stone-400">
              {emailExpanded ? 'Collapse' : 'Edit email'}
              <ChevronDown className={`h-3 w-3 transition-transform ${emailExpanded ? 'rotate-180' : ''}`} />
            </span>
          </button>

          {emailExpanded && (
            <div className="mt-3 grid gap-3 border-t border-stone-100 pt-3">
              <div>
                <Label className="text-[11px] font-medium text-stone-400">Recipients</Label>
                <div className="mt-1 max-h-24 overflow-y-auto rounded-md border border-stone-200 bg-stone-50 p-2">
                  {recipientPool.length === 0 ? (
                    <p className="text-xs text-stone-400">No saved addresses. Add one below.</p>
                  ) : (
                    recipientPool.map((email) => (
                      <label key={email} className="flex min-w-0 items-center gap-2 py-0.5 text-xs text-stone-800">
                        <Checkbox
                          checked={selectedRecipients.some((r) => r.toLowerCase() === email.toLowerCase())}
                          onCheckedChange={() => toggleRecipient(email)}
                          className="h-3.5 w-3.5 shrink-0 data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
                        />
                        <span className="min-w-0 flex-1 truncate" title={email}>{email}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  type="email"
                  value={manualEmailInput}
                  onChange={(event) => setManualEmailInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addManualRecipient()
                    }
                  }}
                  placeholder="email@example.com"
                  className="h-8 text-xs"
                />
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={addManualRecipient}>
                  Add
                </Button>
              </div>

              <div className="grid gap-2 lg:grid-cols-2">
                <div>
                  <Label className="text-[11px] font-medium text-stone-400">CC</Label>
                  <Input
                    value={emailCc}
                    onChange={(event) => setEmailCc(event.target.value)}
                    placeholder="cc@example.com"
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] font-medium text-stone-400">Subject</Label>
                  <Input
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                    placeholder="Invoice from Clean Freaks"
                    className="mt-1 h-8 text-xs"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[11px] font-medium text-stone-400">Message</Label>
                <Textarea
                  value={emailMessage}
                  onChange={(event) => setEmailMessage(event.target.value)}
                  rows={3}
                  className="mt-1 text-xs"
                />
              </div>

              <label className="flex items-center gap-2 border-t border-stone-100 pt-2 text-xs text-stone-600">
                <input
                  type="checkbox"
                  checked={showPaymentOptions}
                  onChange={(event) => setShowPaymentOptions(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                />
                Include Pay Now button
              </label>
            </div>
          )}

          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="truncate text-[11px] italic text-stone-500">
              {notes || (dateDue ? `Due ${new Date(dateDue + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '')}
            </span>
            <button
              type="button"
              onClick={() => setEditingLineItems((value) => !value)}
              className="shrink-0 text-[11px] font-medium text-teal-700 hover:text-teal-800"
            >
              {editingLineItems ? 'Done editing' : 'Edit line items'}
            </button>
          </div>
        </div>

        {editingLineItems && (
          <div className="shrink-0 border-b border-stone-200 bg-white px-5 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">Line Items</span>
              <button
                type="button"
                onClick={addLineItem}
                className="flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:text-teal-800"
              >
                <Plus className="h-3 w-3" />
                Add line item
              </button>
            </div>

            <div className="divide-y divide-stone-100">
              {lineItems.map((item) => (
                <div key={item.id} className="group py-2">
                  {item.isEditing ? (
                    <div className="grid gap-2">
                      <Input
                        value={item.description}
                        onChange={(event) => updateLineItem(item.id, 'description', event.target.value)}
                        placeholder="Description"
                        className="h-8 text-xs"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-stone-400">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.amount}
                          onChange={(event) => updateLineItem(item.id, 'amount', parseFloat(event.target.value) || 0)}
                          className="h-8 w-28 text-right font-mono text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => saveEdit(item.id)}
                          className="h-8 px-2 text-teal-700"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => startEditing(item.id)}
                        className="min-w-0 flex-1 truncate text-left text-xs font-medium text-stone-800 hover:text-teal-700"
                      >
                        {item.description || 'Untitled line item'}
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEditing(item.id)}
                          className="font-mono text-xs font-semibold text-stone-900"
                        >
                          {formatCurrency(item.amount)}
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeLineItem(item.id)}
                          className="h-7 w-7 p-0 text-stone-300 opacity-100 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                          aria-label="Remove line item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center justify-between border-t-2 border-stone-900 pt-2 text-sm">
              <span className="font-semibold text-stone-700">Total</span>
              <span className="font-mono text-base font-bold text-stone-900">{formatCurrency(totalAmount)}</span>
            </div>

            <div className="mt-3">
              <Label className="text-[11px] font-medium text-stone-400">Internal note</Label>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Optional note for this invoice"
                className="mt-1 text-xs"
              />
            </div>
          </div>
        )}
        {/* /left column */}
        </div>

        {/* Right column: invoice preview, fills remaining width on desktop */}
        <div className="flex min-h-0 flex-1 overflow-hidden bg-stone-100 p-2 sm:p-3">
          {isGeneratingPreview ? (
            <div className="m-auto rounded-lg bg-white px-10 py-8 text-center shadow-sm">
              <ActionSpinner size={40} color="#0d9488" className="mx-auto mb-4" />
              <p className="font-semibold text-stone-700">Generating preview...</p>
              <p className="mt-1 text-xs text-stone-500">This usually takes a few seconds.</p>
            </div>
          ) : previewPdfUrl ? (
            <div className="relative h-full w-full">
              <a
                href={previewPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-2.5 top-2.5 z-10 inline-flex items-center gap-1.5 rounded-md bg-stone-900/85 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-md backdrop-blur transition-colors hover:bg-stone-900"
                title="Open the full-size invoice in a new tab to verify the layout and amounts"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open full size
              </a>
              <iframe
                src={`${previewPdfUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                className="h-full w-full rounded-md border-0 bg-white shadow-xl"
                title="Invoice Preview"
              />
            </div>
          ) : (
            <div className={`m-auto rounded-lg border bg-white px-10 py-8 text-center shadow-sm ${previewError ? 'border-red-200' : 'border-stone-200'}`}>
              {previewError ? (
                <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-400" />
              ) : (
                <Eye className="mx-auto mb-4 h-10 w-10 text-stone-300" />
              )}
              <p className="font-semibold text-stone-700">
                {previewError ? 'Preview did not generate' : 'Ready to preview'}
              </p>
              <p className={`mt-1 max-w-sm text-xs ${previewError ? 'text-red-600' : 'text-stone-500'}`}>
                {previewError || 'The preview will appear here once line items are saved.'}
              </p>
              <Button
                type="button"
                onClick={() => handleGeneratePreview()}
                disabled={isGeneratingPreview || lineItems.length === 0}
                className="mt-4 h-8 bg-teal-700 text-xs hover:bg-teal-800"
              >
                <Eye className="mr-2 h-3.5 w-3.5" />
                {previewError ? 'Try again' : 'Generate now'}
              </Button>
            </div>
          )}
        </div>
        {/* /right column */}
        </div>
        {/* /split-panel body */}

        <div className="shrink-0 border-t border-stone-200 bg-white px-4 py-3 sm:px-5">
          {(isCreating || isSendingTest) ? (
            // While an action runs, show ONLY the progress indicator — not the full button row
            // (dimming all four buttons at once made it look like every action was triggered).
            <ProgressBar
              value={progress}
              showLabel
              label={progressStep || 'Processing…'}
            />
          ) : batchMode ? (
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
                Cancel
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={handleBatchSkip} disabled={isCreating} className="text-stone-500">
                  <SkipForward className="mr-1.5 h-4 w-4" />
                  Skip
                </Button>
                <Button
                  onClick={handleBatchApprove}
                  disabled={isCreating || lineItems.length === 0}
                  className="bg-stone-900 text-white hover:bg-stone-800"
                >
                  {isCreating ? <ActionSpinner size={16} color="white" className="mr-2" /> : <Check className="mr-1.5 h-4 w-4" />}
                  {onNext ? 'Save Draft & Next' : 'Save Draft & Finish'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(88px,auto)_1fr] sm:items-center">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isCreating || isSendingTest}
                className="h-10 min-w-0 px-3 sm:w-auto"
              >
                Cancel
              </Button>
              <div className="col-span-2 grid min-w-0 grid-cols-3 gap-2 sm:col-span-1">
                <Button
                  variant="outline"
                  onClick={() => handleCreateInvoice(false)}
                  disabled={!canSubmit}
                  className="h-10 min-w-0 px-2 text-sm"
                >
                  {isCreating ? <ActionSpinner size={15} className="mr-1.5" /> : <Save className="mr-1.5 h-4 w-4 shrink-0" />}
                   Draft
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleCreateInvoice(true)}
                  disabled={!canSubmit}
                  className="h-10 min-w-0 px-2 text-sm"
                >
                  {isSendingTest ? <ActionSpinner size={15} className="mr-1.5" /> : <TestTube className="mr-1.5 h-4 w-4 shrink-0" />}
                  Test
                </Button>
                <Button
                  onClick={handleSendToClient}
                  disabled={!canSubmit}
                  className="h-10 min-w-0 bg-stone-900 px-3 text-sm text-white hover:bg-stone-800"
                >
                  {isCreating ? <ActionSpinner size={15} color="white" className="mr-1.5" /> : <Send className="mr-1.5 h-3 w-3 shrink-0" />}
                  Send
                </Button>
              </div>
            </div>
          )}
        </div>

        {showSendConfirmation && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <Mail className="h-5 w-5 text-amber-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-stone-900">Send invoice to client?</h3>
                  <div className="mt-3 space-y-2 text-sm text-stone-600">
                    <div className="flex justify-between gap-4">
                      <span>To</span>
                      <span className="break-all text-right font-semibold text-stone-900">{selectedRecipients.join(', ')}</span>
                    </div>
                    {emailCc && (
                      <div className="flex justify-between gap-4">
                        <span>CC</span>
                        <span className="break-all text-right font-semibold text-stone-900">{emailCc}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <span>Subject</span>
                      <span className="text-right font-semibold text-stone-900">{emailSubject}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>Amount</span>
                      <span className="font-semibold text-stone-900">{formatCurrency(totalAmount)}</span>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    Real delivery requires production email settings. If safety mode is enabled, this will route to the test address.
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => setShowSendConfirmation(false)} className="flex-1">
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowSendConfirmation(false)
                    handleCreateInvoice(true)
                  }}
                  className="flex-1"
                >
                  <TestTube className="mr-2 h-4 w-4" />
                  Send Test First
                </Button>
                <Button onClick={handleConfirmSendToClient} className="flex-1 bg-stone-900 text-white hover:bg-stone-800">
                  <Send className="mr-2 h-4 w-4" />
                  Send Now
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
