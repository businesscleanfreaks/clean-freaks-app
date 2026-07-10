"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Plus, X, CalendarPlus, Sparkles,
} from "lucide-react"
import { CreateJobDialog } from "@/components/calendar/create-job-dialog"
import { TimePicker } from "@/components/ui/time-picker"
import { ClientInvoiceModal } from "./client-invoice-modal"
import type { ScheduleForModal } from "./client-detail-types"
import type { ClientDetailState } from "./use-client-detail"
import { getScheduleFrequencyLabel } from "./client-detail-helpers"

interface ClientDetailModalsProps {
  state: ClientDetailState
  onOpenRecurringSchedule: (locationId: string) => void
}

export function ClientDetailModals({ state, onOpenRecurringSchedule }: ClientDetailModalsProps) {
  const {
    client,
    subcontractors,

    // Additional service choice
    showAdditionalServiceChoice,
    setShowAdditionalServiceChoice,
    handleAddJob,

    // One-time service dialog
    showOneTimeServiceDialog,
    setShowOneTimeServiceDialog,
    onDataChange,

    // Add job modal
    showAddJobModal,
    setShowAddJobModal,
    addJobSelectedSchedule,
    setAddJobSelectedSchedule,
    addJobDate,
    setAddJobDate,
    addJobCustomTime,
    setAddJobCustomTime,
    addJobTime,
    setAddJobTime,
    addingJob,
    handleAddJobSubmit,
    allSchedulesForModal,

    // Edit client
    editing,
    setEditing,
    formData,
    setFormData,
    handleUpdate,

    // Edit contact
    editingContact,
    setEditingContact,

    // Invoice modal
    showInvoiceModal,
    setShowInvoiceModal,
    creatingInvoice,
    handleCreateInvoice,
  } = state

  const choosePaymentRulePreset = (paymentRulePreset: string) => {
    setFormData({
      ...formData,
      paymentRulePreset,
      ...(paymentRulePreset === 'RESIDENTIAL_STANDARD' ? { propertyType: 'RESIDENTIAL' } : {}),
      ...(paymentRulePreset === 'COMMERCIAL_STANDARD' ? { propertyType: 'COMMERCIAL' } : {}),
    })
  }

  return (
    <>
      {/* Add Additional Service Choice Dialog */}
      {showAdditionalServiceChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowAdditionalServiceChoice(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-in zoom-in-95 fade-in duration-200">
            <div className="bg-gradient-to-r from-teal-600 to-teal-500 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <Plus className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Add service</h2>
                  <p className="text-sm text-white/85">{client.name}</p>
                </div>
              </div>
              <button
                onClick={() => setShowAdditionalServiceChoice(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/20 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-white/80" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {client.locations.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <div className="flex items-start gap-3">
                    <CalendarPlus className="mt-0.5 h-5 w-5 flex-shrink-0 text-teal-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">Recurring clean</p>
                      <p className="mt-0.5 text-xs text-gray-500">Weekly, every 2/3/4/6 weeks, or monthly</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {client.locations.map((location) => (
                          <button
                            key={location.id}
                            type="button"
                            onClick={() => {
                              setShowAdditionalServiceChoice(false)
                              onOpenRecurringSchedule(location.id)
                            }}
                            className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 hover:bg-teal-100"
                          >
                            {client.locations.length === 1 ? 'Create schedule' : location.name || location.address?.split(',')[0] || 'Location'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <button
                onClick={() => {
                  setShowAdditionalServiceChoice(false)
                  handleAddJob()
                }}
                className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-teal-300 hover:bg-teal-50/50 transition-all"
              >
                <div className="flex items-center gap-3">
                  <CalendarPlus className="w-5 h-5 text-teal-600 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Add Extra Clean</p>
                    <p className="text-xs text-gray-500">Add another cleaning date to an existing schedule</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => {
                  setShowAdditionalServiceChoice(false)
                  setShowOneTimeServiceDialog(true)
                }}
                className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-teal-300 hover:bg-teal-50/50 transition-all"
              >
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-teal-600 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">One-Time Job</p>
                    <p className="text-xs text-gray-500">Custom job with custom pricing (deep clean, move-in/out, etc.)</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => {
                  setShowAdditionalServiceChoice(false)
                  setShowOneTimeServiceDialog(true)
                }}
                className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-teal-300 hover:bg-teal-50/50 transition-all"
              >
                <div className="flex items-center gap-3">
                  <Plus className="w-5 h-5 text-teal-600 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Add-On Service</p>
                    <p className="text-xs text-gray-500">Add-on service with custom description and pricing</p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One-Time Service Dialog */}
      <CreateJobDialog
        open={showOneTimeServiceDialog}
        onOpenChange={(open) => {
          setShowOneTimeServiceDialog(open)
          if (!open) onDataChange?.()
        }}
        selectedDate={null}
        clients={[client]}
        subcontractors={subcontractors}
        preSelectedClientId={client.id}
      />

      {/* Add Job Modal */}
      {showAddJobModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => {
              setShowAddJobModal(false)
              setAddJobSelectedSchedule(null)
              setAddJobDate('')
              setAddJobCustomTime(false)
              setAddJobTime('')
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 fade-in duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-teal-600 to-teal-500 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <CalendarPlus className="w-5 h-5" style={{ color: '#FFFFFF' }} />
                </div>
                <div>
                  <h2 className="text-xl font-bold" style={{ color: '#FFFFFF' }}>Add Job</h2>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>{client.name}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAddJobModal(false)
                  setAddJobSelectedSchedule(null)
                  setAddJobDate('')
                  setAddJobCustomTime(false)
                  setAddJobTime('')
                }}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/20 transition-colors duration-150"
                style={{ position: 'absolute' }}
                aria-label="Close"
              >
                <X className="w-5 h-5 text-white/80" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Schedule Selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Which schedule?
                </label>
                <div className="space-y-2">
                  {allSchedulesForModal.map((sch: ScheduleForModal) => (
                    <button
                      key={sch.id}
                      onClick={() => setAddJobSelectedSchedule(sch.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${addJobSelectedSchedule === sch.id
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                    >
                      <div className="font-medium text-gray-900">{sch.locationName}</div>
                      <div className="text-sm text-gray-500">
                        {getScheduleFrequencyLabel(sch.frequency)}
                        {sch.startTime && ` • ${sch.startTime}`}
                        {sch.subcontractor?.name && ` • ${sch.subcontractor.name}`}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Date Selection */}
              {addJobSelectedSchedule && (
                <div className="animate-in slide-in-from-bottom-2 duration-200">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Date
                  </label>
                  <Input
                    type="date"
                    value={addJobDate}
                    onChange={(e) => setAddJobDate(e.target.value)}
                    className="w-full"
                  />
                </div>
              )}

              {/* Custom Time Option */}
              {addJobSelectedSchedule && addJobDate && (
                <div className="animate-in slide-in-from-bottom-2 duration-200">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addJobCustomTime}
                      onChange={(e) => {
                        setAddJobCustomTime(e.target.checked)
                        if (!e.target.checked) setAddJobTime('')
                      }}
                      className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                    />
                    <span className="text-sm text-gray-700">Different time than usual?</span>
                  </label>

                  {addJobCustomTime && (
                    <div className="mt-3 ml-8 w-40">
                      <TimePicker
                        value={addJobTime}
                        onChange={(val) => setAddJobTime(val)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  if (addJobSelectedSchedule) {
                    setAddJobSelectedSchedule(null)
                    setAddJobDate('')
                    setAddJobCustomTime(false)
                    setAddJobTime('')
                    return
                  }
                  setShowAddJobModal(false)
                }}
                className="flex-1"
              >
                {addJobSelectedSchedule ? 'Back' : 'Cancel'}
              </Button>
              {addJobSelectedSchedule && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddJobModal(false)
                    setAddJobSelectedSchedule(null)
                    setAddJobDate('')
                    setAddJobCustomTime(false)
                    setAddJobTime('')
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
              )}
              <Button
                onClick={handleAddJobSubmit}
                disabled={!addJobSelectedSchedule || !addJobDate || (addJobCustomTime && !addJobTime) || addingJob}
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white"
              >
                {addingJob ? 'Adding...' : 'Add Job'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Client Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-gray-200">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-xl font-bold text-gray-900 tracking-tight">Edit Client</h2>
              <button onClick={() => setEditing(false)} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors duration-150" aria-label="Close"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
              <div>
                <Label className="text-xs text-stone-500 uppercase tracking-wider">Client Name</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs text-stone-500 uppercase tracking-wider">Phone</Label>
                <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="mt-1.5" />
              </div>
              {/* Communication Contact */}
              <div className="bg-stone-50 rounded-lg p-4 space-y-3">
                <Label className="text-xs text-stone-600 font-semibold uppercase tracking-wider">Communication Contact</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-stone-400">Name (optional)</Label>
                    <Input
                      value={formData.communicationContactName}
                      onChange={(e) => setFormData({ ...formData, communicationContactName: e.target.value })}
                      placeholder="e.g., John Smith"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">Email</Label>
                    <Input
                      type="email"
                      value={formData.communicationEmail}
                      onChange={(e) => setFormData({ ...formData, communicationEmail: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">Phone</Label>
                    <Input
                      type="tel"
                      value={formData.communicationPhone}
                      onChange={(e) => setFormData({ ...formData, communicationPhone: e.target.value })}
                      placeholder="(310) 555-0100"
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
              {/* Invoicing Contact */}
              <div className="bg-stone-50 rounded-lg p-4 space-y-3">
                <Label className="text-xs text-stone-600 font-semibold uppercase tracking-wider">Invoicing Contact</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-stone-400">Name (optional)</Label>
                    <Input
                      value={formData.invoicingContactName}
                      onChange={(e) => setFormData({ ...formData, invoicingContactName: e.target.value })}
                      placeholder="e.g., Jane Doe"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">Email</Label>
                    <Input
                      type="email"
                      value={formData.invoicingEmail}
                      onChange={(e) => setFormData({ ...formData, invoicingEmail: e.target.value })}
                      placeholder="Leave blank to use communication email"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">CC Email(s)</Label>
                    <Input
                      value={formData.invoicingCcEmail}
                      onChange={(e) => setFormData({ ...formData, invoicingCcEmail: e.target.value })}
                      placeholder="Optional invoice CC"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">Phone</Label>
                    <Input
                      type="tel"
                      value={formData.invoicingPhone}
                      onChange={(e) => setFormData({ ...formData, invoicingPhone: e.target.value })}
                      placeholder="(310) 555-0100"
                      className="mt-1"
                    />
                  </div>
                </div>
                <p className="text-xs text-stone-400">Set a different contact for invoices if needed</p>
              </div>
              <div>
                <Label className="text-xs text-stone-500 uppercase tracking-wider">Start Date</Label>
                <Input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  className="mt-1.5"
                />
                <p className="text-xs text-stone-400 mt-1.5">When the client relationship started</p>
              </div>
              <div>
                <Label className="text-xs text-stone-500 uppercase tracking-wider">Property Type</Label>
                <select
                  value={formData.propertyType}
                  onChange={(e) => setFormData({ ...formData, propertyType: e.target.value })}
                  className="w-full mt-1.5 h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Not set</option>
                  <option value="RESIDENTIAL">Residential</option>
                  <option value="COMMERCIAL">Commercial</option>
                </select>
              </div>
              <div>
                <Label className="text-xs text-stone-500 uppercase tracking-wider">Cleaner Pay Rule</Label>
                <select
                  value={formData.paymentRulePreset}
                  onChange={(e) => choosePaymentRulePreset(e.target.value)}
                  className="w-full mt-1.5 h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">No preset</option>
                  <option value="RESIDENTIAL_STANDARD">Residential Standard</option>
                  <option value="COMMERCIAL_STANDARD">Commercial Standard</option>
                </select>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div>
                  <Label className="text-xs text-stone-500 uppercase tracking-wider">How You Charge</Label>
                  <div className="flex gap-2 mt-1.5">
                    <button type="button" onClick={() => setFormData({ ...formData, billingType: 'PER_CLEAN' })} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${formData.billingType === 'PER_CLEAN' ? 'bg-teal-600 text-white shadow-sm' : 'bg-stone-100 text-gray-600 hover:bg-stone-200'}`}>Per Clean</button>
                    <button type="button" onClick={() => setFormData({ ...formData, billingType: 'FLAT_RATE' })} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${formData.billingType === 'FLAT_RATE' ? 'bg-teal-600 text-white shadow-sm' : 'bg-stone-100 text-gray-600 hover:bg-stone-200'}`}>Monthly</button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-stone-500 uppercase tracking-wider">How You Pay Cleaner</Label>
                  <div className="flex gap-2 mt-1.5">
                    <button type="button" onClick={() => setFormData({ ...formData, cleanerPayType: 'PER_CLEAN' })} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${formData.cleanerPayType === 'PER_CLEAN' ? 'bg-teal-600 text-white shadow-sm' : 'bg-stone-100 text-gray-600 hover:bg-stone-200'}`}>Per Clean</button>
                    <button type="button" onClick={() => setFormData({ ...formData, cleanerPayType: 'FLAT_RATE' })} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${formData.cleanerPayType === 'FLAT_RATE' ? 'bg-teal-600 text-white shadow-sm' : 'bg-stone-100 text-gray-600 hover:bg-stone-200'}`}>Monthly</button>
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs text-stone-500 uppercase tracking-wider">Invoice Timing</Label>
                <select
                  value={formData.invoiceFrequency}
                  onChange={(e) => setFormData({ ...formData, invoiceFrequency: e.target.value })}
                  className="w-full mt-1.5 h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="AFTER_EACH_CLEAN">After each clean</option>
                  <option value="BI_WEEKLY">Bi-weekly</option>
                  <option value="END_OF_MONTH">End of month</option>
                  <option value="CUSTOM">Custom</option>
                </select>
                <p className="text-xs text-stone-400 mt-1">When to generate invoices for this client</p>
              </div>
              <div>
                <Label className="text-xs text-stone-500 uppercase tracking-wider">Notes</Label>
                <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} className="mt-1.5" />
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 rounded-b-2xl flex gap-3 border-t border-gray-100 flex-shrink-0">
              <Button variant="outline" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleUpdate} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white shadow-sm">Save Changes</Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Contact Modal */}
      {editingContact && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditingContact(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 tracking-tight">Edit Contact Info</h2>
              <button onClick={() => setEditingContact(false)} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors duration-150" aria-label="Close"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Communication Contact */}
              <div className="bg-stone-50 rounded-lg p-4 space-y-3">
                <Label className="text-xs text-stone-600 font-semibold uppercase tracking-wider">Communication Contact</Label>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-stone-400">Name (optional)</Label>
                    <Input
                      value={formData.communicationContactName}
                      onChange={(e) => setFormData({ ...formData, communicationContactName: e.target.value })}
                      placeholder="e.g., John Smith"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">Email</Label>
                    <Input
                      type="email"
                      value={formData.communicationEmail}
                      onChange={(e) => setFormData({ ...formData, communicationEmail: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">Phone</Label>
                    <Input
                      type="tel"
                      value={formData.communicationPhone}
                      onChange={(e) => setFormData({ ...formData, communicationPhone: e.target.value })}
                      placeholder="(310) 555-0100"
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
              {/* Invoicing Contact */}
              <div className="bg-stone-50 rounded-lg p-4 space-y-3">
                <Label className="text-xs text-stone-600 font-semibold uppercase tracking-wider">Invoicing Contact</Label>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-stone-400">Name (optional)</Label>
                    <Input
                      value={formData.invoicingContactName}
                      onChange={(e) => setFormData({ ...formData, invoicingContactName: e.target.value })}
                      placeholder="e.g., Jane Doe"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">Email</Label>
                    <Input
                      type="email"
                      value={formData.invoicingEmail}
                      onChange={(e) => setFormData({ ...formData, invoicingEmail: e.target.value })}
                      placeholder="Leave blank to use communication email"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">CC Email(s)</Label>
                    <Input
                      value={formData.invoicingCcEmail}
                      onChange={(e) => setFormData({ ...formData, invoicingCcEmail: e.target.value })}
                      placeholder="Optional invoice CC"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-stone-400">Phone</Label>
                    <Input
                      type="tel"
                      value={formData.invoicingPhone}
                      onChange={(e) => setFormData({ ...formData, invoicingPhone: e.target.value })}
                      placeholder="(310) 555-0100"
                      className="mt-1"
                    />
                  </div>
                </div>
                <p className="text-xs text-stone-400">Set a different contact if invoices should go elsewhere</p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 rounded-b-2xl flex gap-3 border-t border-gray-100">
              <Button variant="outline" onClick={() => setEditingContact(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleUpdate} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white shadow-sm">Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Invoice Modal */}
      {showInvoiceModal && (
        <ClientInvoiceModal
          client={client}
          onClose={() => setShowInvoiceModal(false)}
          onCreateInvoice={handleCreateInvoice}
          creatingInvoice={creatingInvoice}
        />
      )}
    </>
  )
}
