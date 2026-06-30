"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Trash2 } from "lucide-react"
import { showError, showSuccess, showApiError } from "@/lib/toast"
import { createClientSchema, updateClientSchema, formatZodErrors } from "@/lib/validations"
import { logger } from "@/lib/logger"
import { InlineHelp } from "@/components/ui/inline-help"
import { SimpleTooltip } from "@/components/ui/simple-tooltip"

interface Location {
  id?: string
  name: string
  address: string
}

type PropertyType = 'RESIDENTIAL' | 'COMMERCIAL'

interface ClientFormProps {
  client?: {
    id: string
    name: string
    phone: string | null
    communicationEmail: string | null
    communicationContactName: string | null
    communicationPhone: string | null
    invoicingEmail: string | null
    invoicingCcEmail: string | null
    invoicingContactName: string | null
    invoicingPhone: string | null
    billingType: 'FLAT_RATE' | 'PER_CLEAN'
    cleanerPayType: 'FLAT_RATE' | 'PER_CLEAN'
    invoiceFrequency: 'AFTER_EACH_CLEAN' | 'BI_WEEKLY' | 'END_OF_MONTH' | 'CUSTOM'
    propertyType: PropertyType | null
    preferredPaymentMethod: string | null
    notes: string | null
    locations: Location[]
  }
}

const PAYMENT_METHOD_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'ZELLE', label: 'Zelle' },
  { value: 'DIRECT_DEPOSIT', label: 'Direct Deposit' },
  { value: 'CHECK', label: 'Check' },
  { value: 'OTHER', label: 'Other' },
]

const INVOICE_FREQUENCY_OPTIONS = [
  { value: 'AFTER_EACH_CLEAN', label: 'After each clean', description: 'Invoice immediately after each completed cleaning' },
  { value: 'BI_WEEKLY', label: 'Bi-weekly', description: 'Group cleans into 2-week billing periods' },
  { value: 'END_OF_MONTH', label: 'End of month', description: 'Invoice all cleans at the end of each month' },
  { value: 'CUSTOM', label: 'Custom', description: 'Manually select which cleans to include in each invoice' },
]

const PROPERTY_TYPE_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'RESIDENTIAL', label: 'Residential' },
  { value: 'COMMERCIAL', label: 'Commercial' },
]

export function ClientForm({ client }: ClientFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: client?.name || '',
    phone: client?.phone || '',
    communicationEmail: client?.communicationEmail || '',
    communicationContactName: client?.communicationContactName || '',
    communicationPhone: client?.communicationPhone || '',
    invoicingEmail: client?.invoicingEmail || '',
    invoicingCcEmail: client?.invoicingCcEmail || '',
    invoicingContactName: client?.invoicingContactName || '',
    invoicingPhone: client?.invoicingPhone || '',
    billingType: client?.billingType || 'PER_CLEAN',
    cleanerPayType: client?.cleanerPayType || 'PER_CLEAN',
    invoiceFrequency: client?.invoiceFrequency || 'END_OF_MONTH',
    propertyType: client?.propertyType || '',
    preferredPaymentMethod: client?.preferredPaymentMethod || '',
    notes: client?.notes || '',
  })
  const [locations, setLocations] = useState<Location[]>(
    client?.locations || []
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Client-side validation
    const schema = client ? updateClientSchema : createClientSchema
    const validationData = {
      ...formData,
      locations: client ? undefined : locations,
    }
    
    const validationResult = schema.safeParse(validationData)
    if (!validationResult.success) {
      const errors = formatZodErrors(validationResult.error)
      showError(errors[0] || 'Please check all required fields')
      return
    }
    
    setLoading(true)

    try {
      const url = client
        ? `/api/clients/${client.id}`
        : '/api/clients'
      const method = client ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validationResult.data),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to save client')
        return
      }

      showSuccess(client ? 'Client updated successfully' : 'Client created successfully')
      router.push('/clients')
      // Refresh data in background after navigation
      setTimeout(() => router.refresh(), 200)
    } catch (error) {
      logger.error('Error saving client:', error)
      showError('Failed to save client. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const addLocation = () => {
    setLocations([...locations, { name: '', address: '' }])
  }

  const removeLocation = (index: number) => {
    setLocations(locations.filter((_, i) => i !== index))
  }

  const updateLocation = (index: number, field: keyof Location, value: string) => {
    const newLocations = [...locations]
    newLocations[index] = { ...newLocations[index], [field]: value }
    setLocations(newLocations)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Client Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>

          {/* Communication Contact */}
          <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
            <Label className="text-sm font-semibold text-gray-700">Communication Contact</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="communicationContactName" className="text-xs text-gray-500">Contact Name (optional)</Label>
                <Input
                  id="communicationContactName"
                  value={formData.communicationContactName}
                  onChange={(e) =>
                    setFormData({ ...formData, communicationContactName: e.target.value })
                  }
                  placeholder="e.g., John Smith"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="communicationEmail" className="text-xs text-gray-500">Email</Label>
                <Input
                  id="communicationEmail"
                  type="email"
                  value={formData.communicationEmail}
                  onChange={(e) =>
                    setFormData({ ...formData, communicationEmail: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="communicationPhone" className="text-xs text-gray-500">Phone</Label>
                <Input
                  id="communicationPhone"
                  type="tel"
                  value={formData.communicationPhone}
                  onChange={(e) =>
                    setFormData({ ...formData, communicationPhone: e.target.value })
                  }
                  placeholder="(310) 555-0100"
                />
              </div>
            </div>
          </div>

          {/* Invoicing Contact */}
          <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
            <Label className="text-sm font-semibold text-gray-700">Invoicing Contact</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invoicingContactName" className="text-xs text-gray-500">Contact Name (optional)</Label>
                <Input
                  id="invoicingContactName"
                  value={formData.invoicingContactName}
                  onChange={(e) =>
                    setFormData({ ...formData, invoicingContactName: e.target.value })
                  }
                  placeholder="e.g., Jane Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoicingEmail" className="text-xs text-gray-500">Email</Label>
                <Input
                  id="invoicingEmail"
                  type="email"
                  value={formData.invoicingEmail}
                  onChange={(e) =>
                    setFormData({ ...formData, invoicingEmail: e.target.value })
                  }
                  placeholder="Defaults to communication email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoicingCcEmail" className="text-xs text-gray-500">CC Email(s)</Label>
                <Input
                  id="invoicingCcEmail"
                  value={formData.invoicingCcEmail}
                  onChange={(e) =>
                    setFormData({ ...formData, invoicingCcEmail: e.target.value })
                  }
                  placeholder="Optional invoice CC"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoicingPhone" className="text-xs text-gray-500">Phone</Label>
                <Input
                  id="invoicingPhone"
                  type="tel"
                  value={formData.invoicingPhone}
                  onChange={(e) =>
                    setFormData({ ...formData, invoicingPhone: e.target.value })
                  }
                  placeholder="(310) 555-0100"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                Client Billing Type *
                <InlineHelp content="help-billing-types" />
              </Label>
              <p className="text-xs text-muted-foreground">How you charge the client</p>
              <div className="flex gap-4">
                <SimpleTooltip content="billing-flat-rate">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="FLAT_RATE"
                      checked={formData.billingType === 'FLAT_RATE'}
                      onChange={(e) =>
                        setFormData({ ...formData, billingType: e.target.value as 'FLAT_RATE' | 'PER_CLEAN' })
                      }
                    />
                    Monthly Flat Rate
                  </label>
                </SimpleTooltip>
                <SimpleTooltip content="billing-per-clean">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="PER_CLEAN"
                      checked={formData.billingType === 'PER_CLEAN'}
                      onChange={(e) =>
                        setFormData({ ...formData, billingType: e.target.value as 'FLAT_RATE' | 'PER_CLEAN' })
                      }
                    />
                    Per Clean
                  </label>
                </SimpleTooltip>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>
                Cleaner Pay Type *
                <InlineHelp content="help-cleaner-pay-types" />
              </Label>
              <p className="text-xs text-muted-foreground">How you pay the cleaner</p>
              <div className="flex gap-4">
                <SimpleTooltip content="cleaner-pay-flat-rate">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="FLAT_RATE"
                      checked={formData.cleanerPayType === 'FLAT_RATE'}
                      onChange={(e) =>
                        setFormData({ ...formData, cleanerPayType: e.target.value as 'FLAT_RATE' | 'PER_CLEAN' })
                      }
                    />
                    Monthly Flat
                  </label>
                </SimpleTooltip>
                <SimpleTooltip content="cleaner-pay-per-clean">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="PER_CLEAN"
                      checked={formData.cleanerPayType === 'PER_CLEAN'}
                      onChange={(e) =>
                        setFormData({ ...formData, cleanerPayType: e.target.value as 'FLAT_RATE' | 'PER_CLEAN' })
                      }
                    />
                    Per Clean
                  </label>
                </SimpleTooltip>
              </div>
            </div>
          </div>

          {/* Property Type */}
          <div className="space-y-2">
            <Label>Property Type</Label>
            <select
              value={formData.propertyType}
              onChange={(e) => setFormData({ ...formData, propertyType: e.target.value as PropertyType | '' })}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            >
              {PROPERTY_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Invoice Frequency */}
          <div className="space-y-2">
            <Label>
              Invoice Timing
              <InlineHelp content="help-invoice-timing" />
            </Label>
            <p className="text-xs text-muted-foreground">When to generate invoices for this client</p>
            <select
              value={formData.invoiceFrequency}
              onChange={(e) => setFormData({ ...formData, invoiceFrequency: e.target.value as 'AFTER_EACH_CLEAN' | 'BI_WEEKLY' | 'END_OF_MONTH' | 'CUSTOM' })}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            >
              {INVOICE_FREQUENCY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {INVOICE_FREQUENCY_OPTIONS.find(o => o.value === formData.invoiceFrequency)?.description}
            </p>
          </div>

          {/* Preferred Payment Method */}
          <div className="space-y-2">
            <Label>Preferred Payment Method</Label>
            <p className="text-xs text-muted-foreground">How this client typically pays invoices</p>
            <select
              value={formData.preferredPaymentMethod}
              onChange={(e) => setFormData({ ...formData, preferredPaymentMethod: e.target.value || '' })}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            >
              {PAYMENT_METHOD_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">
              Notes
              <InlineHelp content="client-notes" />
            </Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Access codes, gate codes, special instructions, etc."
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      {!client && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Locations</CardTitle>
              <Button type="button" onClick={addLocation} variant="outline" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add Location
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {locations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No locations yet. Add at least one location for this client.
              </p>
            ) : (
              locations.map((location, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="font-medium">Location {index + 1}</h4>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLocation(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Location Name *</Label>
                      <Input
                        value={location.name}
                        onChange={(e) => updateLocation(index, 'name', e.target.value)}
                        placeholder="e.g., Main Office"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Address *</Label>
                      <Input
                        value={location.address}
                        onChange={(e) => updateLocation(index, 'address', e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4">
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving...' : client ? 'Update Client' : 'Create Client'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/clients')}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
