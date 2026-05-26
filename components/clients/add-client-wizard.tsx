"use client"

import { useState, useEffect, Fragment } from "react"
import { createPortal } from "react-dom"
import { Input } from "@/components/ui/input"

import {
  X, Plus, Trash2, MapPin, Calendar, DollarSign, User, Users, Mail,
  Phone, Key, Check, Clock, Sparkles, Building2, FileText, Copy, ArrowLeft,
} from "lucide-react"
import { ActionSpinner } from "@/components/ui/action-spinner"
import { logger } from "@/lib/logger"
import { showError } from "@/lib/toast"
import { generateQuarterHourTimes, formatTimeLabel } from "@/lib/time-utils"

interface Subcontractor {
  id: string
  name: string
}

interface AddOnData {
  id: string
  description: string
  clientRate: string
  subcontractorRate: string
  frequency: string
  sameSchedule: boolean
  customDaysOfWeek: number[]
}

interface ExtraLocationData {
  id: string
  name: string
  address: string
  accessInfo: string
  sameSchedule: boolean
  frequency: string
  monthlyDay?: number
  monthlyDays?: number[]
  daysOfWeek: number[]
  timeType: 'SPECIFIC' | 'WINDOW'
  startTime: string
  startWindowBegin: string
  startWindowEnd: string
  clientRate: string
  billingType: 'PER_CLEAN' | 'FLAT_RATE'
  subcontractorId: string
  subcontractorRate: string
  cleanerPayType: 'PER_CLEAN' | 'FLAT_RATE'
}

interface AddClientWizardInitialData {
  sourceProspectId?: string | null
  clientName?: string | null
  phone?: string | null
  email?: string | null
  communicationContactName?: string | null
  notes?: string | null
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const FREQUENCIES = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BI_WEEKLY', label: 'Every 2 Wks' },
  { value: 'EVERY_3_WEEKS', label: 'Every 3 Wks' },
  { value: 'EVERY_4_WEEKS', label: 'Every 4 Wks' },
  { value: 'EVERY_6_WEEKS', label: 'Every 6 Wks' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: '2X_MONTHLY', label: '2x Monthly' },
]

const QUICK_ADD_SERVICES = [
  { icon: '🪟', label: 'Windows (Int)', description: 'Window Cleaning - Interior', defaultFrequency: 'MONTHLY' },
  { icon: '🪟', label: 'Windows (Ext)', description: 'Window Cleaning - Exterior', defaultFrequency: 'MONTHLY' },
  { icon: '🪟', label: 'Windows (Both)', description: 'Window Cleaning - Interior & Exterior', defaultFrequency: 'MONTHLY' },
  { icon: '💧', label: 'Power Wash', description: 'Power Washing', defaultFrequency: 'MONTHLY' },
  { icon: '🧹', label: 'Deep Clean', description: 'Deep Clean', defaultFrequency: 'EVERY_6_WEEKS' },
  { icon: '🗄️', label: 'Cabinets', description: 'Cabinet Cleaning', defaultFrequency: 'MONTHLY' },
  { icon: '🧶', label: 'Carpet', description: 'Carpet Cleaning', defaultFrequency: 'MONTHLY' },
  { icon: '🍳', label: 'Oven', description: 'Appliance Deep Clean - Oven', defaultFrequency: 'MONTHLY' },
  { icon: '🧊', label: 'Fridge', description: 'Appliance Deep Clean - Fridge', defaultFrequency: 'MONTHLY' },
]

function generateId() {
  return Math.random().toString(36).substr(2, 9)
}

function clampDayOfMonth(value: number) {
  return Math.min(28, Math.max(1, Number.isFinite(value) ? value : 1))
}

function normalizeTwiceMonthlyDays(days?: number[]) {
  const normalized = (days && days.length > 0 ? days : [1, 15])
    .map(day => clampDayOfMonth(day))
    .filter((day, index, list) => list.indexOf(day) === index)

  while (normalized.length < 2) {
    normalized.push(normalized[0] === 15 ? 1 : 15)
  }

  return normalized.slice(0, 2).sort((a, b) => a - b)
}

function isFixedMonthlyFrequency(frequency: string) {
  return frequency === 'MONTHLY' || frequency === '2X_MONTHLY'
}

function buildMonthlyPattern(frequency: string, monthlyDay: number, monthlyDays?: number[]) {
  if (frequency === '2X_MONTHLY') {
    return JSON.stringify({ type: 'FIXED_DATES', dates: normalizeTwiceMonthlyDays(monthlyDays) })
  }

  if (frequency === 'MONTHLY') {
    return JSON.stringify({ type: 'FIXED_DATES', dates: [clampDayOfMonth(monthlyDay)] })
  }

  return null
}

function getScheduleTimeError(
  timeType: 'SPECIFIC' | 'WINDOW',
  startTime: string,
  startWindowBegin: string,
  startWindowEnd: string
) {
  if (timeType === 'SPECIFIC') {
    return startTime ? '' : 'Select a start time'
  }

  if (!startWindowBegin || !startWindowEnd) {
    return 'Select a full arrival window'
  }

  if (startWindowBegin >= startWindowEnd) {
    return 'Arrival window end must be after start'
  }

  return ''
}

// ── Shared sub-components ────────────────────────────────────────────────────

function DayPicker({ selected, onChange }: { selected: number[]; onChange: (d: number[]) => void }) {
  const toggle = (day: number) => {
    onChange(selected.includes(day) ? selected.filter(d => d !== day) : [...selected, day].sort())
  }
  return (
    <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
      {DAYS.map((d, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => toggle(idx)}
          style={{
            flex: 1,
            minWidth: 0,
            height: '32px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            backgroundColor: selected.includes(idx) ? '#00A896' : '#F1F5F9',
            color: selected.includes(idx) ? 'white' : '#94A3B8',
            transition: 'all 0.15s ease',
          }}
        >
          {d}
        </button>
      ))}
    </div>
  )
}

function FrequencyPills({ selected, onChange }: { selected: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {FREQUENCIES.map(freq => (
        <button
          key={freq.value}
          type="button"
          onClick={() => onChange(freq.value)}
          style={{
            padding: '7px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            backgroundColor: selected === freq.value ? '#00A896' : 'white',
            color: selected === freq.value ? 'white' : '#111111',
            border: selected === freq.value ? '1px solid #00A896' : '1px solid #E0E0E0',
          }}
        >
          {freq.label}
        </button>
      ))}
    </div>
  )
}

function TogglePill({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 14px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        backgroundColor: active ? '#00A896' : 'white',
        color: active ? 'white' : '#5F6368',
        border: active ? '1px solid #00A896' : '1px solid #E0E0E0',
      }}
    >
      {label}
    </button>
  )
}

function StepLabel({ text }: { text: string }) {
  return (
    <p style={{ fontSize: '12px', fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
      {text}
    </p>
  )
}

function SectionHeading({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
      <Icon style={{ width: '20px', height: '20px', color: '#00A896', flexShrink: 0 }} />
      <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#111111', margin: 0 }}>{text}</h3>
    </div>
  )
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p style={{ fontSize: '12px', color: '#E53935', marginTop: '4px' }}>{msg}</p>
}

function CleanInput({
  value, onChange, placeholder, type = 'text', error,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  error?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        height: '44px',
        padding: '0 12px',
        borderRadius: '8px',
        border: error ? '1px solid #E53935' : '1px solid #E0E0E0',
        fontSize: '14px',
        color: '#111111',
        outline: 'none',
        backgroundColor: 'white',
        boxSizing: 'border-box',
      }}
      onFocus={e => {
        e.currentTarget.style.border = error ? '1px solid #E53935' : '1px solid #00A896'
        e.currentTarget.style.boxShadow = error ? '0 0 0 3px rgba(229,57,53,0.08)' : '0 0 0 3px rgba(0,168,150,0.08)'
      }}
      onBlur={e => {
        e.currentTarget.style.border = error ? '1px solid #E53935' : '1px solid #E0E0E0'
        e.currentTarget.style.boxShadow = 'none'
      }}
    />
  )
}

// Extra location card
function ExtraLocationCard({
  location, index, subcontractors, onUpdate, onRemove,
}: {
  location: ExtraLocationData
  index: number
  subcontractors: Subcontractor[]
  onUpdate: (data: Partial<ExtraLocationData>) => void
  onRemove: () => void
}) {
  const isFixedMonthly = isFixedMonthlyFrequency(location.frequency)
  const twiceMonthlyDays = normalizeTwiceMonthlyDays(location.monthlyDays ?? [location.monthlyDay ?? 1, 15])
  return (
    <div style={{ background: 'white', border: '1px solid #EEEEEE', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 style={{ width: '16px', height: '16px', color: '#00A896' }} />
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#111111' }}>Location {index + 2}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BBBBBB', padding: '4px' }}
          className="hover:text-red-500 transition-colors"
        >
          <Trash2 style={{ width: '15px', height: '15px' }} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <CleanInput
          value={location.address}
          onChange={v => onUpdate({ address: v })}
          placeholder="Full address"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <CleanInput
            value={location.name}
            onChange={v => onUpdate({ name: v })}
            placeholder="Location nickname"
          />
          <CleanInput
            value={location.accessInfo}
            onChange={v => onUpdate({ accessInfo: v })}
            placeholder="Gate code, key location..."
          />
        </div>
      </div>

      <div style={{ borderTop: '1px solid #F5F5F5', marginTop: '12px', paddingTop: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={location.sameSchedule}
            onChange={e => onUpdate({ sameSchedule: e.target.checked })}
            style={{ accentColor: '#00A896', width: '16px', height: '16px' }}
          />
          <span style={{ fontSize: '13px', color: '#5F6368' }}>Same schedule as primary location</span>
        </label>
      </div>

      {/* Independent schedule UI when sameSchedule is unchecked */}
      {!location.sameSchedule && (
        <div style={{ borderTop: '1px solid #F5F5F5', marginTop: '12px', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Frequency */}
          <div>
            <StepLabel text="Frequency" />
            <FrequencyPills
              selected={location.frequency}
              onChange={v => onUpdate({
                frequency: v,
                ...(v === '2X_MONTHLY' ? { monthlyDays: twiceMonthlyDays } : {}),
                ...(v === 'MONTHLY' ? { monthlyDay: location.monthlyDay || 1 } : {}),
              })}
            />
          </div>

          {/* Days or Day-of-month */}
          {isFixedMonthly ? (
            <div>
              <StepLabel text={location.frequency === '2X_MONTHLY' ? 'Days of month' : 'Day of month'} />
              {location.frequency === '2X_MONTHLY' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {[0, 1].map(index => (
                    <input
                      key={index}
                      type="number"
                      min={1}
                      max={28}
                      value={twiceMonthlyDays[index]}
                      onChange={e => {
                        const next = [...twiceMonthlyDays]
                        next[index] = clampDayOfMonth(parseInt(e.target.value) || 1)
                        onUpdate({ monthlyDays: normalizeTwiceMonthlyDays(next) })
                      }}
                      style={{
                        width: '70px', height: '40px', padding: '0 12px', borderRadius: '8px',
                        border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                        textAlign: 'center',
                      }}
                    />
                  ))}
                  <span style={{ fontSize: '13px', color: '#888888' }}>of each month</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={location.monthlyDay || 1}
                    onChange={e => onUpdate({ monthlyDay: clampDayOfMonth(parseInt(e.target.value) || 1) })}
                    style={{
                      width: '70px', height: '40px', padding: '0 12px', borderRadius: '8px',
                      border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                      textAlign: 'center',
                    }}
                  />
                  <span style={{ fontSize: '13px', color: '#888888' }}>of each month</span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <StepLabel text="Which days?" />
              <DayPicker selected={location.daysOfWeek} onChange={d => onUpdate({ daysOfWeek: d })} />
            </div>
          )}

          {/* Time type */}
          <div>
            <StepLabel text="Arrival time" />
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <TogglePill label="Specific time" active={location.timeType === 'SPECIFIC'} onClick={() => onUpdate({ timeType: 'SPECIFIC' })} />
              <TogglePill label="Time window" active={location.timeType === 'WINDOW'} onClick={() => onUpdate({ timeType: 'WINDOW' })} />
            </div>
            {location.timeType === 'SPECIFIC' ? (
              <select
                value={location.startTime}
                onChange={e => onUpdate({ startTime: e.target.value })}
                style={{
                  height: '40px', padding: '0 12px', borderRadius: '8px',
                  border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                  backgroundColor: 'white', minWidth: '150px',
                }}
              >
                <option value="">Select time</option>
                {generateQuarterHourTimes().map(t => (
                  <option key={t} value={t}>{formatTimeLabel(t)}</option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: '#888888' }}>Between</span>
                <select
                  value={location.startWindowBegin}
                  onChange={e => onUpdate({ startWindowBegin: e.target.value })}
                  style={{
                    height: '40px', padding: '0 12px', borderRadius: '8px',
                    border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                    backgroundColor: 'white',
                  }}
                >
                  <option value="">Start</option>
                  {generateQuarterHourTimes().map(t => (
                    <option key={t} value={t}>{formatTimeLabel(t)}</option>
                  ))}
                </select>
                <span style={{ color: '#BBBBBB', fontSize: '16px' }}>—</span>
                <select
                  value={location.startWindowEnd}
                  onChange={e => onUpdate({ startWindowEnd: e.target.value })}
                  style={{
                    height: '40px', padding: '0 12px', borderRadius: '8px',
                    border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                    backgroundColor: 'white',
                  }}
                >
                  <option value="">End</option>
                  {generateQuarterHourTimes().map(t => (
                    <option key={t} value={t}>{formatTimeLabel(t)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Rates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <StepLabel text="Client rate" />
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#888888', fontSize: '15px', pointerEvents: 'none' }}>$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={location.clientRate}
                  onChange={e => onUpdate({ clientRate: e.target.value })}
                  placeholder="150"
                  style={{
                    width: '100%', height: '40px', paddingLeft: '28px', paddingRight: '12px',
                    borderRadius: '8px', border: '1px solid #E0E0E0',
                    fontSize: '14px', fontWeight: 600, color: '#111111', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div>
              <StepLabel text="Cleaner rate" />
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#888888', fontSize: '15px', pointerEvents: 'none' }}>$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={location.subcontractorRate}
                  onChange={e => onUpdate({ subcontractorRate: e.target.value })}
                  placeholder="100"
                  style={{
                    width: '100%', height: '40px', paddingLeft: '28px', paddingRight: '12px',
                    borderRadius: '8px', border: '1px solid #E0E0E0',
                    fontSize: '14px', fontWeight: 600, color: '#111111', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Cleaner assignment */}
          <div>
            <StepLabel text="Assigned Cleaner" />
            <select
              value={location.subcontractorId}
              onChange={e => onUpdate({ subcontractorId: e.target.value })}
              style={{
                width: '100%', height: '40px', padding: '0 12px',
                borderRadius: '8px', border: '1px solid #E0E0E0',
                fontSize: '13px', color: location.subcontractorId ? '#111111' : '#BBBBBB',
                backgroundColor: 'white', outline: 'none', cursor: 'pointer',
              }}
            >
              <option value="">Same as primary</option>
              {subcontractors.map(sub => (
                <option key={sub.id} value={sub.id}>{sub.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Wizard ──────────────────────────────────────────────────────────────

export function AddClientWizard({
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: {
  isOpen: boolean
  onClose: () => void
  onSuccess: (clientId: string) => void
  initialData?: AddClientWizardInitialData | null
}) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([])
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [direction, setDirection] = useState(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sourceProspectId, setSourceProspectId] = useState<string | null>(null)
  const [clientType, setClientType] = useState<'RECURRING' | 'ONE_TIME'>('RECURRING')

  // Step 1: Client Info
  const [clientName, setClientName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [communicationContactName, setCommunicationContactName] = useState('')
  const [communicationPhone, setCommunicationPhone] = useState('')
  const [sameEmail, setSameEmail] = useState(true)
  const [invoicingEmail, setInvoicingEmail] = useState('')
  const [invoicingCcEmail, setInvoicingCcEmail] = useState('')
  const [invoicingContactName, setInvoicingContactName] = useState('')
  const [invoicingPhone, setInvoicingPhone] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])

  // Step 2: Location
  const [address, setAddress] = useState('')
  const [locationName, setLocationName] = useState('')
  const [accessInfo, setAccessInfo] = useState('')
  const [extraLocations, setExtraLocations] = useState<ExtraLocationData[]>([])

  // Step 3: Schedule
  const [frequency, setFrequency] = useState('WEEKLY')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([])
  const [monthlyDay, setMonthlyDay] = useState(1)
  const [monthlyDays, setMonthlyDays] = useState<number[]>([1, 15])
  const [timeType, setTimeType] = useState<'SPECIFIC' | 'WINDOW'>('WINDOW')
  const [startTime, setStartTime] = useState('')
  const [startWindowBegin, setStartWindowBegin] = useState('09:00')
  const [startWindowEnd, setStartWindowEnd] = useState('12:00')
  const [firstCleanDate, setFirstCleanDate] = useState('')

  // Step 4: Pricing & Cleaner
  const [clientRate, setClientRate] = useState('')
  const [billingType, setBillingType] = useState<'PER_CLEAN' | 'FLAT_RATE'>('PER_CLEAN')
  const [subcontractorId, setSubcontractorId] = useState('')
  const [subcontractorRate, setSubcontractorRate] = useState('')
  const [cleanerPayType, setCleanerPayType] = useState<'PER_CLEAN' | 'FLAT_RATE'>('PER_CLEAN')

  // Step 5: Extras
  const [notes, setNotes] = useState('')
  const [addOns, setAddOns] = useState<AddOnData[]>([])

  useEffect(() => {
    if (isOpen) {
      fetch('/api/subcontractors')
        .then(res => res.json())
        .then(data => setSubcontractors(Array.isArray(data) ? data : []))
        .catch(error => logger.error('Error fetching subcontractors:', error))
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !initialData) return

    setSourceProspectId(initialData.sourceProspectId || null)
    setClientName(initialData.clientName || '')
    setPhone(initialData.phone || '')
    setEmail(initialData.email || '')
    setCommunicationContactName(initialData.communicationContactName || '')
    setNotes(initialData.notes || '')
    setStep(1)
    setDirection(1)
    setClientType('RECURRING')
  }, [initialData, isOpen])

  const createEmptyExtraLocation = (): ExtraLocationData => ({
    id: generateId(),
    name: '',
    address: '',
    accessInfo: '',
    sameSchedule: true,
    frequency: 'WEEKLY',
    monthlyDay: 1,
    monthlyDays: [1, 15],
    daysOfWeek: [],
    timeType: 'WINDOW',
    startTime: '',
    startWindowBegin: '09:00',
    startWindowEnd: '12:00',
    clientRate: '',
    billingType: 'PER_CLEAN',
    subcontractorId: '',
    subcontractorRate: '',
    cleanerPayType: 'PER_CLEAN',
  })

  const resetForm = () => {
    setStep(1)
    setDirection(1)
    setErrors({})
    setClientType('RECURRING')
    setClientName('')
    setPhone('')
    setEmail('')
    setCommunicationContactName('')
    setCommunicationPhone('')
    setSameEmail(true)
    setInvoicingEmail('')
    setInvoicingCcEmail('')
    setInvoicingContactName('')
    setInvoicingPhone('')
    setStartDate(new Date().toISOString().split('T')[0])
    setAddress('')
    setLocationName('')
    setAccessInfo('')
    setExtraLocations([])
    setFrequency('WEEKLY')
    setDaysOfWeek([])
    setMonthlyDay(1)
    setMonthlyDays([1, 15])
    setTimeType('WINDOW')
    setStartTime('')
    setStartWindowBegin('09:00')
    setStartWindowEnd('12:00')
    setFirstCleanDate('')
    setClientRate('')
    setBillingType('PER_CLEAN')
    setSubcontractorId('')
    setSubcontractorRate('')
    setCleanerPayType('PER_CLEAN')
    setNotes('')
    setAddOns([])
    setSourceProspectId(null)
  }

  const addAddOn = (preset?: { description: string; defaultFrequency: string }) => {
    setAddOns(prev => [...prev, {
      id: generateId(),
      description: preset?.description || '',
      clientRate: '',
      subcontractorRate: '',
      frequency: preset?.defaultFrequency || 'MONTHLY',
      sameSchedule: true,
      customDaysOfWeek: [],
    }])
  }

  const updateAddOn = (id: string, data: Partial<AddOnData>) => {
    setAddOns(prev => prev.map(a => a.id === id ? { ...a, ...data } : a))
  }

  const removeAddOn = (id: string) => {
    setAddOns(prev => prev.filter(a => a.id !== id))
  }

  const updateExtraLocation = (id: string, data: Partial<ExtraLocationData>) => {
    setExtraLocations(prev => prev.map(l => l.id === id ? { ...l, ...data } : l))
  }

  const removeExtraLocation = (id: string) => {
    setExtraLocations(prev => prev.filter(l => l.id !== id))
  }

  const isValidEmail = (val: string) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
  const isValidEmailList = (val: string) =>
    !val ||
    val
      .split(/[;,]/)
      .map(item => item.trim())
      .filter(Boolean)
      .every(isValidEmail)

  const goNext = () => {
    const newErrors: Record<string, string> = {}

    if (step === 1) {
      if (!clientName.trim()) newErrors.clientName = 'Client name is required'
      if (email && !isValidEmail(email)) newErrors.email = 'Invalid email format'
      if (!sameEmail && invoicingEmail && !isValidEmail(invoicingEmail)) {
        newErrors.invoicingEmail = 'Invalid email format'
      }
      if (invoicingCcEmail && !isValidEmailList(invoicingCcEmail)) {
        newErrors.invoicingCcEmail = 'Invalid CC email format'
      }
    }

    if (step === 2) {
      if (!address.trim()) newErrors.address = 'Address is required'
    }

    if (step === 3) {
      if (!isFixedMonthlyFrequency(frequency) && daysOfWeek.length === 0) newErrors.daysOfWeek = 'Select at least one day'
      const timeError = getScheduleTimeError(timeType, startTime, startWindowBegin, startWindowEnd)
      if (timeError) newErrors.scheduleTime = timeError
    }

    if (step === 4) {
      if (!clientRate || !clientRate.trim() || isNaN(parseFloat(clientRate)) || parseFloat(clientRate) <= 0) {
        newErrors.clientRate = 'Enter a valid rate greater than $0'
      }
      if (subcontractorId && (!subcontractorRate || !subcontractorRate.trim() || isNaN(parseFloat(subcontractorRate)) || parseFloat(subcontractorRate) < 0)) {
        newErrors.subcontractorRate = 'Enter a valid cleaner rate'
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      const firstError = Object.values(newErrors)[0]
      showError(firstError)
      return
    }
    setErrors({})
    setDirection(1)
    setStep(s => (Math.min(5, s + 1)) as 1 | 2 | 3 | 4 | 5)
  }

  const goBack = () => {
    setDirection(-1)
    setErrors({})
    setStep(s => (Math.max(1, s - 1)) as 1 | 2 | 3 | 4 | 5)
  }

  // Progress message state for slow creation
  const [submitProgress, setSubmitProgress] = useState('')

  const handleSubmit = async () => {
    const submitErrors: Record<string, string> = {}
    if (!clientName.trim()) submitErrors.clientName = 'Client name is required'
    if (!address.trim()) submitErrors.address = 'Address is required'
    if (email && !isValidEmail(email)) submitErrors.email = 'Invalid email format'
    if (!sameEmail && invoicingEmail && !isValidEmail(invoicingEmail)) {
      submitErrors.invoicingEmail = 'Invalid email format'
    }
    if (invoicingCcEmail && !isValidEmailList(invoicingCcEmail)) {
      submitErrors.invoicingCcEmail = 'Invalid CC email format'
    }
    if (clientType === 'RECURRING') {
      if (!isFixedMonthlyFrequency(frequency) && daysOfWeek.length === 0) {
        submitErrors.daysOfWeek = 'Select at least one schedule day'
      }
      const timeError = getScheduleTimeError(timeType, startTime, startWindowBegin, startWindowEnd)
      if (timeError) {
        submitErrors.scheduleTime = timeError
      }
      if (!clientRate || Number.isNaN(parseFloat(clientRate)) || parseFloat(clientRate) <= 0) {
        submitErrors.clientRate = 'Enter a valid client rate'
      }
      if (subcontractorId && (!subcontractorRate || Number.isNaN(parseFloat(subcontractorRate)) || parseFloat(subcontractorRate) < 0)) {
        submitErrors.subcontractorRate = 'Enter a valid cleaner rate'
      }

      const invalidExtraLocation = extraLocations.find(extraLoc => {
        if (extraLoc.sameSchedule) return false
        if (!extraLoc.address.trim()) return false
        if (!isFixedMonthlyFrequency(extraLoc.frequency) && extraLoc.daysOfWeek.length === 0) return true
        if (!extraLoc.clientRate || Number.isNaN(parseFloat(extraLoc.clientRate)) || parseFloat(extraLoc.clientRate) <= 0) return true
        return !!getScheduleTimeError(extraLoc.timeType, extraLoc.startTime, extraLoc.startWindowBegin, extraLoc.startWindowEnd)
      })
      if (invalidExtraLocation) {
        submitErrors.extraLocations = 'Finish the independent schedule for each added location'
      }
    }

    if (Object.keys(submitErrors).length > 0) {
      setErrors(submitErrors)
      showError(Object.values(submitErrors)[0])
      return
    }

    setErrors({})

    setIsSubmitting(true)
    setSubmitProgress('Creating client...')
    const t0 = performance.now()
    let createdClientId: string | null = null
    let primaryLocationId: string | null = null

    // Show "Still working..." after 5 seconds
    const slowTimer = setTimeout(() => {
      setSubmitProgress('Still working — setting up schedule...')
    }, 5000)

    try {
      // Step 1: Create client
      const clientRes = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clientName.trim(),
          phone: phone || null,
          communicationEmail: email || null,
          communicationContactName: communicationContactName || null,
          communicationPhone: communicationPhone || null,
          invoicingEmail: sameEmail ? (email || null) : (invoicingEmail || null),
          invoicingCcEmail: invoicingCcEmail || null,
          invoicingContactName: sameEmail ? (communicationContactName || null) : (invoicingContactName || null),
          invoicingPhone: sameEmail ? (communicationPhone || null) : (invoicingPhone || null),
          billingType,
          cleanerPayType,
          startDate: startDate || null,
          notes: notes || null,
          sourceProspectId,
        }),
      })

      if (!clientRes.ok) {
        const err = await clientRes.json()
        throw new Error(err.error || 'Failed to create client')
      }

      const client = await clientRes.json()
      createdClientId = client.id
      logger.debug(`[wizard] Client created in ${Math.round(performance.now() - t0)}ms`)

      // Step 2: Create primary location
      if (address.trim()) {
        const t1 = performance.now()
        const locRes = await fetch('/api/locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: client.id,
            name: locationName || 'Primary Location',
            address: address.trim(),
            accessInfo: accessInfo || null,
          }),
        })

        if (!locRes.ok) {
          logger.error('[wizard] Primary location creation failed')
          showError('Client created but location setup failed')
        } else {
          const loc = await locRes.json()
          primaryLocationId = loc.id
          logger.debug(`[wizard] Location created in ${Math.round(performance.now() - t1)}ms`)

          // Step 3: Create schedule + jobs (this is the slow part)
          const canCreateSchedule = clientType === 'RECURRING' && (isFixedMonthlyFrequency(frequency) ? true : daysOfWeek.length > 0)
          if (canCreateSchedule && clientRate) {
            const t2 = performance.now()
            setSubmitProgress('Setting up schedule...')
            const schedPayload: Record<string, unknown> = {
              locationId: loc.id,
              frequency,
              daysOfWeek: isFixedMonthlyFrequency(frequency) ? null : JSON.stringify(daysOfWeek),
              startDate: startDate || new Date().toISOString(),
              defaultClientRate: parseFloat(clientRate) || 0,
              defaultSubcontractorRate: parseFloat(subcontractorRate) || 0,
              clientPayType: billingType,
              subcontractorPayType: cleanerPayType,
              subcontractorId: subcontractorId || null,
              timeType,
              startTime: timeType === 'SPECIFIC' ? startTime : null,
              startWindowBegin: timeType === 'WINDOW' ? startWindowBegin : null,
              startWindowEnd: timeType === 'WINDOW' ? startWindowEnd : null,
            }
            const monthlyPattern = buildMonthlyPattern(frequency, monthlyDay, monthlyDays)
            if (monthlyPattern) {
              schedPayload.monthlyPattern = monthlyPattern
            }
            const schedRes = await fetch('/api/schedules', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(schedPayload),
            })

            if (schedRes.ok) {
              const sched = await schedRes.json()
              logger.debug(`[wizard] Schedule + jobs created in ${Math.round(performance.now() - t2)}ms`)

              // Step 4: Create add-ons in parallel
              const validAddOns = addOns.filter(a => a.description)
              if (validAddOns.length > 0) {
                const t3 = performance.now()
                const addOnPromises = validAddOns.map(addOn =>
                  fetch('/api/add-on-services', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      scheduleId: sched.id,
                      description: addOn.description,
                      clientRate: parseFloat(addOn.clientRate) || 0,
                      subcontractorRate: parseFloat(addOn.subcontractorRate) || 0,
                      isRecurring: addOn.frequency !== 'ONE_TIME',
                      frequency: addOn.frequency === 'ONE_TIME' ? null : addOn.frequency,
                    }),
                  }).catch(err => { logger.error('[wizard] Add-on creation failed:', err) })
                )
                await Promise.all(addOnPromises)
                logger.debug(`[wizard] ${validAddOns.length} add-ons created in ${Math.round(performance.now() - t3)}ms (parallel)`)
              }
            } else {
              const err = await schedRes.json().catch(() => ({}))
              logger.error('Schedule creation failed in wizard:', err)
              showError('Client created but schedule setup failed')
            }
          }
        }
      }

      // Step 5: Create extra locations in parallel
      if (extraLocations.length > 0) {
        const t4 = performance.now()
        setSubmitProgress('Setting up extra locations...')
        const extraLocationPromises = extraLocations
          .filter(el => el.address.trim())
          .map(async (extraLoc) => {
            const locRes = await fetch('/api/locations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId: client.id,
                name: extraLoc.name || 'Location',
                address: extraLoc.address.trim(),
                accessInfo: extraLoc.accessInfo || null,
              }),
            })
            if (!locRes.ok) return
            const loc = await locRes.json()
            if (clientType === 'RECURRING' && extraLoc.sameSchedule) {
              if ((isFixedMonthlyFrequency(frequency) || daysOfWeek.length > 0) && clientRate) {
                const schedulePayload: Record<string, unknown> = {
                  locationId: loc.id,
                  frequency,
                  daysOfWeek: isFixedMonthlyFrequency(frequency) ? null : JSON.stringify(daysOfWeek),
                  startDate: startDate || new Date().toISOString(),
                  defaultClientRate: parseFloat(clientRate) || 0,
                  defaultSubcontractorRate: parseFloat(subcontractorRate) || 0,
                  clientPayType: billingType,
                  subcontractorPayType: cleanerPayType,
                  subcontractorId: subcontractorId || null,
                  timeType,
                  startTime: timeType === 'SPECIFIC' ? startTime : null,
                  startWindowBegin: timeType === 'WINDOW' ? startWindowBegin : null,
                  startWindowEnd: timeType === 'WINDOW' ? startWindowEnd : null,
                }
                const monthlyPattern = buildMonthlyPattern(frequency, monthlyDay, monthlyDays)
                if (monthlyPattern) {
                  schedulePayload.monthlyPattern = monthlyPattern
                }
                await fetch('/api/schedules', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(schedulePayload),
                })
              }
            } else if (clientType === 'RECURRING') {
              if ((isFixedMonthlyFrequency(extraLoc.frequency) || extraLoc.daysOfWeek.length > 0) && extraLoc.clientRate) {
                const schedulePayload: Record<string, unknown> = {
                  locationId: loc.id,
                  frequency: extraLoc.frequency,
                  daysOfWeek: isFixedMonthlyFrequency(extraLoc.frequency) ? null : JSON.stringify(extraLoc.daysOfWeek),
                  startDate: startDate || new Date().toISOString(),
                  defaultClientRate: parseFloat(extraLoc.clientRate) || 0,
                  defaultSubcontractorRate: parseFloat(extraLoc.subcontractorRate) || 0,
                  clientPayType: extraLoc.billingType,
                  subcontractorPayType: extraLoc.cleanerPayType,
                  subcontractorId: extraLoc.subcontractorId || null,
                  timeType: extraLoc.timeType,
                  startTime: extraLoc.timeType === 'SPECIFIC' ? extraLoc.startTime : null,
                  startWindowBegin: extraLoc.timeType === 'WINDOW' ? extraLoc.startWindowBegin : null,
                  startWindowEnd: extraLoc.timeType === 'WINDOW' ? extraLoc.startWindowEnd : null,
                }
                const monthlyPattern = buildMonthlyPattern(extraLoc.frequency, extraLoc.monthlyDay || 1, extraLoc.monthlyDays)
                if (monthlyPattern) {
                  schedulePayload.monthlyPattern = monthlyPattern
                }
                await fetch('/api/schedules', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(schedulePayload),
                })
              }
            }
          })
        await Promise.allSettled(extraLocationPromises)
        logger.debug(`[wizard] Extra locations created in ${Math.round(performance.now() - t4)}ms (parallel)`)
      }

      // Step 6: Create trial / intro clean one-off job — use primaryLocationId directly
      // instead of re-fetching from API (saves a round trip)
      if (clientType === 'RECURRING' && firstCleanDate && primaryLocationId) {
        try {
          await fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              locationId: primaryLocationId,
              date: firstCleanDate,
              startTime: timeType === 'SPECIFIC' ? startTime : null,
              startWindowBegin: timeType === 'WINDOW' ? startWindowBegin : null,
              startWindowEnd: timeType === 'WINDOW' ? startWindowEnd : null,
              clientRate: parseFloat(clientRate) || 0,
              subcontractorRate: parseFloat(subcontractorRate) || 0,
              subcontractorId: subcontractorId || null,
              scheduleId: null,
              isTrial: true,
              trialNotes: null,
            }),
          })
        } catch (err) {
          logger.error('Error creating trial clean job:', err)
        }
      }

      logger.debug(`[wizard] Total creation time: ${Math.round(performance.now() - t0)}ms`)

      // Success — navigate and close
      onSuccess(client.id)
      onClose()
      resetForm()
    } catch (err) {
      logger.error('Error creating client:', err)
      showError(err instanceof Error ? err.message : 'Failed to create client')
      // If client was created but later steps failed, still navigate to it
      if (createdClientId) {
        onSuccess(createdClientId)
        onClose()
        resetForm()
      }
    } finally {
      clearTimeout(slowTimer)
      setIsSubmitting(false)
      setSubmitProgress('')
    }
  }

  if (!isOpen) return null
  if (typeof document === 'undefined') return null

  const canCreate = !!clientName.trim() && !!address.trim()
  const stepLabels = ['Client', 'Location', 'Schedule', 'Pricing', 'Extras']

  const selectedSubcontractor = subcontractors.find(sub => sub.id === subcontractorId)
  const margin = (parseFloat(clientRate) || 0) - (parseFloat(subcontractorRate) || 0)

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15,23,42,0.42)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflow: 'auto',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-client-title"
        style={{
          width: 'min(560px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          borderRadius: '14px',
          backgroundColor: 'white',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          margin: 'auto',
        }}
      >
        <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #F1F5F9', position: 'relative', flexShrink: 0 }}>
          <h2 id="add-client-title" style={{ fontSize: '19px', fontWeight: 700, color: '#0F172A', margin: 0 }}>
            Add New Client
          </h2>
          <p style={{ margin: '3px 42px 0 0', color: '#64748B', fontSize: '12px', lineHeight: 1.35 }}>
            Client, location, schedule, pricing, contacts, and add-ons in one pass.
          </p>
          <button
            type="button"
            onClick={() => { onClose(); resetForm() }}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: '12px',
              right: '14px',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
            }}
            className="hover:bg-gray-100 transition-colors"
          >
            <X style={{ width: '18px', height: '18px', color: '#64748B' }} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <section style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px' }}>
            <StepLabel text="Client" />
            <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: '7px', padding: '2px', marginBottom: '10px' }}>
              <button
                type="button"
                onClick={() => setClientType('RECURRING')}
                style={{
                  flex: 1,
                  height: '30px',
                  border: 'none',
                  borderRadius: '5px',
                  background: clientType === 'RECURRING' ? 'white' : 'transparent',
                  boxShadow: clientType === 'RECURRING' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  color: clientType === 'RECURRING' ? '#0F172A' : '#94A3B8',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Recurring
              </button>
              <button
                type="button"
                onClick={() => setClientType('ONE_TIME')}
                style={{
                  flex: 1,
                  height: '30px',
                  border: 'none',
                  borderRadius: '5px',
                  background: clientType === 'ONE_TIME' ? 'white' : 'transparent',
                  boxShadow: clientType === 'ONE_TIME' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  color: clientType === 'ONE_TIME' ? '#0F172A' : '#94A3B8',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                One-Time
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(150px, 0.8fr)', gap: '8px' }}>
              <div>
                <StepLabel text="Name" />
                <CleanInput
                  value={clientName}
                  onChange={v => { setClientName(v); setErrors(e => ({ ...e, clientName: '' })) }}
                  placeholder="Business or client name"
                  error={!!errors.clientName}
                />
                <FieldError msg={errors.clientName} />
              </div>
              <div>
                <StepLabel text="Client since" />
                <CleanInput value={startDate} onChange={setStartDate} type="date" />
              </div>
            </div>
          </section>

          <section style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px' }}>
            <StepLabel text="Location and Contact" />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(130px, 0.9fr)', gap: '8px', marginBottom: '8px' }}>
              <div>
                <CleanInput
                  value={address}
                  onChange={v => { setAddress(v); setErrors(e => ({ ...e, address: '' })) }}
                  placeholder="Full address"
                  error={!!errors.address}
                />
                <FieldError msg={errors.address} />
              </div>
              <CleanInput value={locationName} onChange={setLocationName} placeholder="Location name" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginBottom: '8px' }}>
              <CleanInput value={communicationContactName} onChange={setCommunicationContactName} placeholder="Contact name" />
              <CleanInput
                value={email}
                onChange={v => { setEmail(v); setErrors(e => ({ ...e, email: '' })) }}
                placeholder="Contact email"
                type="email"
                error={!!errors.email}
              />
              <CleanInput value={communicationPhone} onChange={setCommunicationPhone} placeholder="Contact phone" />
              <CleanInput value={phone} onChange={setPhone} placeholder="Client phone" />
            </div>
            <FieldError msg={errors.email} />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '8px', alignItems: 'start' }}>
              <textarea
                value={accessInfo}
                onChange={e => setAccessInfo(e.target.value)}
                placeholder="Entry code, key location, parking notes..."
                style={{
                  width: '100%',
                  minHeight: '40px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #E0E0E0',
                  color: '#111111',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: '40px', color: '#475569', fontSize: '12px', cursor: 'pointer' }}>
                <input type="checkbox" checked={sameEmail} onChange={e => setSameEmail(e.target.checked)} style={{ accentColor: '#00A896' }} />
                Same invoice email
              </label>
            </div>
            {!sameEmail && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginTop: '8px' }}>
                <CleanInput value={invoicingContactName} onChange={setInvoicingContactName} placeholder="Invoice contact" />
                <CleanInput
                  value={invoicingEmail}
                  onChange={v => { setInvoicingEmail(v); setErrors(e => ({ ...e, invoicingEmail: '' })) }}
                  placeholder="Invoice email"
                  type="email"
                  error={!!errors.invoicingEmail}
                />
                <CleanInput value={invoicingPhone} onChange={setInvoicingPhone} placeholder="Invoice phone" />
                <CleanInput
                  value={invoicingCcEmail}
                  onChange={v => { setInvoicingCcEmail(v); setErrors(e => ({ ...e, invoicingCcEmail: '' })) }}
                  placeholder="Invoice CC emails"
                  error={!!errors.invoicingCcEmail}
                />
              </div>
            )}
            {sameEmail && (
              <div style={{ marginTop: '8px' }}>
                <CleanInput
                  value={invoicingCcEmail}
                  onChange={v => { setInvoicingCcEmail(v); setErrors(e => ({ ...e, invoicingCcEmail: '' })) }}
                  placeholder="Invoice CC emails"
                  error={!!errors.invoicingCcEmail}
                />
              </div>
            )}
            <FieldError msg={errors.invoicingEmail || errors.invoicingCcEmail} />
          </section>

          {clientType === 'RECURRING' && (
            <section style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px' }}>
              <StepLabel text="Schedule and Pricing" />
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(140px, 0.7fr)', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <StepLabel text="Frequency" />
                  <FrequencyPills selected={frequency} onChange={setFrequency} />
                </div>
                <div>
                  {isFixedMonthlyFrequency(frequency) ? (
                    <>
                      <StepLabel text={frequency === '2X_MONTHLY' ? 'Days of month' : 'Day of month'} />
                      {frequency === '2X_MONTHLY' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          {[0, 1].map(index => (
                            <CleanInput
                              key={index}
                              value={String(normalizeTwiceMonthlyDays(monthlyDays)[index])}
                              onChange={v => {
                                const next = [...normalizeTwiceMonthlyDays(monthlyDays)]
                                next[index] = clampDayOfMonth(parseInt(v) || 1)
                                setMonthlyDays(normalizeTwiceMonthlyDays(next))
                              }}
                              type="number"
                            />
                          ))}
                        </div>
                      ) : (
                        <CleanInput value={String(monthlyDay)} onChange={v => setMonthlyDay(clampDayOfMonth(parseInt(v) || 1))} type="number" />
                      )}
                    </>
                  ) : (
                    <>
                      <StepLabel text="Days" />
                      <DayPicker selected={daysOfWeek} onChange={v => { setDaysOfWeek(v); setErrors(e => ({ ...e, daysOfWeek: '' })) }} />
                      <FieldError msg={errors.daysOfWeek} />
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <StepLabel text="Arrival" />
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <TogglePill label="Specific" active={timeType === 'SPECIFIC'} onClick={() => setTimeType('SPECIFIC')} />
                    <TogglePill label="Window" active={timeType === 'WINDOW'} onClick={() => setTimeType('WINDOW')} />
                  </div>
                  {timeType === 'SPECIFIC' ? (
                    <select value={startTime} onChange={e => setStartTime(e.target.value)} style={{ width: '100%', height: '40px', borderRadius: '8px', border: '1px solid #E0E0E0', backgroundColor: 'white', color: '#111111', fontSize: '13px', padding: '0 10px', outline: 'none' }}>
                      <option value="">Select time</option>
                      {generateQuarterHourTimes().map(time => <option key={time} value={time}>{formatTimeLabel(time)}</option>)}
                    </select>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <select value={startWindowBegin} onChange={e => setStartWindowBegin(e.target.value)} style={{ width: '100%', height: '40px', borderRadius: '8px', border: '1px solid #E0E0E0', backgroundColor: 'white', color: '#111111', fontSize: '13px', padding: '0 10px', outline: 'none' }}>
                        {generateQuarterHourTimes().map(time => <option key={time} value={time}>{formatTimeLabel(time)}</option>)}
                      </select>
                      <select value={startWindowEnd} onChange={e => setStartWindowEnd(e.target.value)} style={{ width: '100%', height: '40px', borderRadius: '8px', border: '1px solid #E0E0E0', backgroundColor: 'white', color: '#111111', fontSize: '13px', padding: '0 10px', outline: 'none' }}>
                        {generateQuarterHourTimes().map(time => <option key={time} value={time}>{formatTimeLabel(time)}</option>)}
                      </select>
                    </div>
                  )}
                  <FieldError msg={errors.scheduleTime} />
                </div>
                <div>
                  <StepLabel text="Cleaner" />
                  <select value={subcontractorId} onChange={e => setSubcontractorId(e.target.value)} style={{ width: '100%', height: '40px', borderRadius: '8px', border: '1px solid #E0E0E0', backgroundColor: 'white', color: '#111111', fontSize: '13px', padding: '0 10px', outline: 'none' }}>
                    <option value="">Unassigned</option>
                    {subcontractors.map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
                  </select>
                  <div style={{ marginTop: '8px' }}>
                    <StepLabel text="First intro clean" />
                    <CleanInput value={firstCleanDate} onChange={setFirstCleanDate} type="date" />
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                <div>
                  <StepLabel text="Client rate" />
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <TogglePill label="Per clean" active={billingType === 'PER_CLEAN'} onClick={() => setBillingType('PER_CLEAN')} />
                    <TogglePill label="Monthly" active={billingType === 'FLAT_RATE'} onClick={() => setBillingType('FLAT_RATE')} />
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B' }}>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={clientRate}
                      onChange={e => { setClientRate(e.target.value); setErrors(er => ({ ...er, clientRate: '' })) }}
                      placeholder="150"
                      style={{ width: '100%', height: '40px', paddingLeft: '26px', paddingRight: '10px', borderRadius: '8px', border: errors.clientRate ? '1px solid #E53935' : '1px solid #E0E0E0', fontSize: '14px', fontWeight: 600, color: '#111111', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <FieldError msg={errors.clientRate} />
                </div>
                <div>
                  <StepLabel text="Cleaner pay" />
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <TogglePill label="Per clean" active={cleanerPayType === 'PER_CLEAN'} onClick={() => setCleanerPayType('PER_CLEAN')} />
                    <TogglePill label="Monthly" active={cleanerPayType === 'FLAT_RATE'} onClick={() => setCleanerPayType('FLAT_RATE')} />
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B' }}>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={subcontractorRate}
                      onChange={e => { setSubcontractorRate(e.target.value); setErrors(er => ({ ...er, subcontractorRate: '' })) }}
                      placeholder={selectedSubcontractor ? `Pay ${selectedSubcontractor.name}` : 'Cleaner rate'}
                      style={{ width: '100%', height: '40px', paddingLeft: '26px', paddingRight: '10px', borderRadius: '8px', border: errors.subcontractorRate ? '1px solid #E53935' : '1px solid #E0E0E0', fontSize: '14px', fontWeight: 600, color: '#111111', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <FieldError msg={errors.subcontractorRate} />
                </div>
              </div>
              {(clientRate || subcontractorRate) && (
                <div style={{ marginTop: '7px', textAlign: 'right', color: '#64748B', fontSize: '12px' }}>
                  Margin: <strong style={{ color: margin >= 0 ? '#15803D' : '#DC2626' }}>${margin.toFixed(2)}</strong>/{billingType === 'FLAT_RATE' ? 'mo' : 'clean'}
                </div>
              )}
            </section>
          )}

          <section style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: extraLocations.length ? '10px' : 0 }}>
              <StepLabel text="Additional Locations" />
              <button type="button" onClick={() => setExtraLocations(prev => [...prev, createEmptyExtraLocation()])} style={{ border: 'none', background: 'none', color: '#0D9488', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                + Add location
              </button>
            </div>
            {extraLocations.map((location, idx) => (
              <ExtraLocationCard
                key={location.id}
                location={location}
                index={idx}
                subcontractors={subcontractors}
                onUpdate={data => updateExtraLocation(location.id, data)}
                onRemove={() => removeExtraLocation(location.id)}
              />
            ))}
            <FieldError msg={errors.extraLocations} />
          </section>

          <section style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
              <StepLabel text="Add-ons and Notes" />
              {clientType === 'RECURRING' && (
                <button type="button" onClick={() => addAddOn()} style={{ border: 'none', background: 'none', color: '#0D9488', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  + Add service
                </button>
              )}
            </div>
            {clientType === 'RECURRING' && addOns.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                {addOns.map(addOn => (
                  <div key={addOn.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px 96px 120px auto', gap: '6px', alignItems: 'center' }}>
                    <CleanInput value={addOn.description} onChange={v => updateAddOn(addOn.id, { description: v })} placeholder="Service" />
                    <CleanInput value={addOn.clientRate} onChange={v => updateAddOn(addOn.id, { clientRate: v })} placeholder="Client $" type="number" />
                    <CleanInput value={addOn.subcontractorRate} onChange={v => updateAddOn(addOn.id, { subcontractorRate: v })} placeholder="Pay $" type="number" />
                    <select value={addOn.frequency} onChange={e => updateAddOn(addOn.id, { frequency: e.target.value })} style={{ width: '100%', height: '40px', borderRadius: '8px', border: '1px solid #E0E0E0', backgroundColor: 'white', color: '#111111', fontSize: '13px', padding: '0 10px', outline: 'none' }}>
                      <option value="ONE_TIME">One time</option>
                      {FREQUENCIES.map(freq => <option key={freq.value} value={freq.value}>{freq.label}</option>)}
                    </select>
                    <button type="button" aria-label="Remove add-on" onClick={() => removeAddOn(addOn.id)} style={{ border: 'none', background: 'none', color: '#94A3B8', cursor: 'pointer', padding: '4px' }}>
                      <Trash2 style={{ width: '15px', height: '15px' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes or special instructions"
              style={{
                width: '100%',
                minHeight: '56px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #E0E0E0',
                color: '#111111',
                fontSize: '13px',
                fontFamily: 'inherit',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </section>
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', gap: '10px', background: 'white', flexShrink: 0 }}>
          <button type="button" onClick={() => { onClose(); resetForm() }} style={{ height: '42px', padding: '0 18px', borderRadius: '8px', border: '1px solid #CBD5E1', color: '#0F172A', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !canCreate}
            style={{
              minWidth: '152px',
              height: '42px',
              padding: '0 18px',
              border: 'none',
              borderRadius: '8px',
              background: canCreate && !isSubmitting ? '#00A896' : '#CBD5E1',
              color: 'white',
              fontSize: '14px',
              fontWeight: 700,
              cursor: canCreate && !isSubmitting ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {isSubmitting ? (
              <>{submitProgress || 'Creating...'} <ActionSpinner size={15} color="white" /></>
            ) : (
              'Create Client'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )



  // Legacy alternate layout — unreachable after the createPortal return above. Kept as dead code to avoid
  // a large surgical removal; intentionally unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _legacyRender = (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '5vh', paddingBottom: '24px', paddingLeft: '24px', paddingRight: '24px',
      }}
    >
      <div
        style={{
          width: '560px', height: 'min(640px, calc(100vh - 48px))', borderRadius: '12px',
          backgroundColor: 'white', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* ── Header ───────────────────────────────────────── */}
        <div
          style={{
            padding: '20px 24px 16px', borderBottom: '1px solid #EEEEEE',
            flexShrink: 0, position: 'relative',
          }}
        >
          <button
            onClick={() => { onClose(); resetForm() }}
            aria-label="Close"
            style={{
              position: 'absolute', top: '16px', right: '16px',
              width: '36px', height: '36px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', background: 'none', cursor: 'pointer',
            }}
            className="hover:bg-gray-100 transition-colors"
          >
            <X style={{ width: '18px', height: '18px', color: '#5F6368' }} />
          </button>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111111', margin: 0 }}>
            Add New Client
          </h2>
          <p style={{ fontSize: '13px', color: '#888888', marginTop: '4px', marginBottom: 0 }}>
            Let&apos;s set up your new cleaning client
          </p>
        </div>

        {/* ── Progress Stepper ─────────────────────────────── */}
        <div
          style={{
            padding: '16px 32px', borderBottom: '1px solid #EEEEEE',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {stepLabels.map((label, idx) => {
              const s = idx + 1
              const isCompleted = s < step
              const isCurrent = s === step
              return (
                <Fragment key={s}>
                  {idx > 0 && (
                    <div
                      style={{
                        flex: 1, height: '2px', marginTop: '13px',
                        backgroundColor: s <= step ? '#00A896' : '#EEEEEE',
                      }}
                    />
                  )}
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                      style={{
                        width: '28px', height: '28px', borderRadius: '50%',
                        backgroundColor: isCurrent || isCompleted ? '#00A896' : '#F5F5F5',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {isCompleted ? (
                        <Check style={{ width: '13px', height: '13px', color: 'white' }} />
                      ) : (
                        <span style={{ fontSize: '12px', fontWeight: 600, color: isCurrent ? 'white' : '#BBBBBB', lineHeight: 1 }}>
                          {s}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '5px', gap: '2px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: isCurrent || isCompleted ? 600 : 400,
                          color: isCurrent || isCompleted ? '#00A896' : '#BBBBBB',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </span>
                      {s === 5 && (
                        <span
                          style={{
                            fontSize: '9px', color: '#888888',
                            backgroundColor: '#F5F5F5', padding: '1px 5px',
                            borderRadius: '4px', whiteSpace: 'nowrap',
                          }}
                        >
                          Optional
                        </span>
                      )}
                    </div>
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>

        {/* ── Animated Content ─────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div
              key={step}
              className="animate-in"
              style={{
                position: 'absolute', inset: 0,
                padding: '24px', overflowY: 'auto',
              }}
            >

              {/* ── STEP 1: Client Info ──────────────────── */}
              {step === 1 && (
                <div>
                  <SectionHeading icon={User} text="Who is this client?" />

                  {/* Client name */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 500, color: '#111111', display: 'block', marginBottom: '6px' }}>
                      Client Name <span style={{ color: '#E53935' }}>*</span>
                    </label>
                    <CleanInput
                      value={clientName}
                      onChange={v => { setClientName(v); setErrors(e => ({ ...e, clientName: '' })) }}
                      placeholder="ABC Company"
                      error={!!errors.clientName}
                    />
                    <FieldError msg={errors.clientName} />
                  </div>

                  {/* Phone + Start Date */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label style={{ fontSize: '13px', fontWeight: 500, color: '#111111', display: 'block', marginBottom: '6px' }}>Phone</label>
                      <CleanInput value={phone} onChange={setPhone} placeholder="(555) 123-4567" />
                    </div>
                    <div>
                      <label style={{ fontSize: '13px', fontWeight: 500, color: '#111111', display: 'block', marginBottom: '6px' }}>Start Date</label>
                      <CleanInput value={startDate} onChange={setStartDate} type="date" />
                    </div>
                  </div>

                  {/* Communication contact card */}
                  <div
                    style={{
                      backgroundColor: '#F9F9F9', borderRadius: '8px',
                      padding: '14px', marginBottom: '12px',
                    }}
                  >
                    <StepLabel text="Communication Contact" />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <CleanInput
                        value={communicationContactName}
                        onChange={setCommunicationContactName}
                        placeholder="Contact name (optional)"
                      />
                      <CleanInput
                        value={email}
                        onChange={v => { setEmail(v); setErrors(e => ({ ...e, email: '' })) }}
                        placeholder="Email"
                        type="email"
                        error={!!errors.email}
                      />
                      <FieldError msg={errors.email} />
                      <CleanInput
                        value={communicationPhone}
                        onChange={setCommunicationPhone}
                        placeholder="Phone (optional)"
                        type="tel"
                      />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={sameEmail}
                        onChange={e => setSameEmail(e.target.checked)}
                        style={{ accentColor: '#00A896', width: '15px', height: '15px' }}
                      />
                      <span style={{ fontSize: '13px', color: '#5F6368' }}>Send invoices to this email</span>
                    </label>
                    <div style={{ marginTop: '10px' }}>
                      <CleanInput
                        value={invoicingCcEmail}
                        onChange={v => { setInvoicingCcEmail(v); setErrors(e => ({ ...e, invoicingCcEmail: '' })) }}
                        placeholder="Invoice CC email(s), optional"
                        type="text"
                        error={!!errors.invoicingCcEmail}
                      />
                      <FieldError msg={errors.invoicingCcEmail} />
                    </div>
                  </div>

                  {/* Separate invoicing contact (if different) */}
                  {!sameEmail && (
                    <div
                      style={{
                        backgroundColor: '#F9F9F9', borderRadius: '8px',
                        padding: '14px',
                      }}
                    >
                      <StepLabel text="Invoicing Contact" />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <CleanInput
                          value={invoicingContactName}
                          onChange={setInvoicingContactName}
                          placeholder="Contact name (optional)"
                        />
                        <CleanInput
                          value={invoicingEmail}
                          onChange={v => { setInvoicingEmail(v); setErrors(e => ({ ...e, invoicingEmail: '' })) }}
                          placeholder="billing@company.com"
                          type="email"
                          error={!!errors.invoicingEmail}
                        />
                        <FieldError msg={errors.invoicingEmail} />
                        <CleanInput
                          value={invoicingPhone}
                          onChange={setInvoicingPhone}
                          placeholder="Phone (optional)"
                          type="tel"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP 2: Location ─────────────────────── */}
              {step === 2 && (
                <div>
                  <SectionHeading icon={MapPin} text="Where do they need cleaning?" />

                  {/* Primary location card */}
                  <div
                    style={{
                      border: '1px solid #EEEEEE', borderRadius: '8px',
                      padding: '16px', marginBottom: '12px', backgroundColor: 'white',
                    }}
                  >
                    <div style={{ marginBottom: '10px' }}>
                      <CleanInput
                        value={address}
                        onChange={v => { setAddress(v); setErrors(e => ({ ...e, address: '' })) }}
                        placeholder="123 Main St, Los Angeles, CA 90001"
                        error={!!errors.address}
                      />
                      <FieldError msg={errors.address} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <CleanInput
                        value={locationName}
                        onChange={setLocationName}
                        placeholder="Location nickname (optional)"
                      />
                      <CleanInput
                        value={accessInfo}
                        onChange={setAccessInfo}
                        placeholder="Gate code, key location, etc."
                      />
                    </div>
                  </div>

                  {/* Extra locations */}
                  {extraLocations.map((loc, idx) => (
                    <ExtraLocationCard
                      key={loc.id}
                      location={loc}
                      index={idx}
                      subcontractors={subcontractors}
                      onUpdate={data => updateExtraLocation(loc.id, data)}
                      onRemove={() => removeExtraLocation(loc.id)}
                    />
                  ))}

                  {/* Add another location */}
                  <button
                    type="button"
                    onClick={() => setExtraLocations(prev => [...prev, createEmptyExtraLocation()])}
                    style={{
                      width: '100%', height: '44px', borderRadius: '8px',
                      border: '2px dashed #00A896', backgroundColor: 'white',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: '2px',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(0,168,150,0.04)' }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Plus style={{ width: '16px', height: '16px', color: '#00A896' }} />
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#00A896' }}>Add Another Location</span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#888888' }}>For multi-site clients</span>
                  </button>
                </div>
              )}

              {/* ── STEP 3: Schedule ─────────────────────── */}
              {step === 3 && (
                <div>
                  <SectionHeading icon={Calendar} text="How often do they need cleaning?" />

                  {/* Frequency */}
                  <div style={{ marginBottom: '18px' }}>
                    <FrequencyPills selected={frequency} onChange={setFrequency} />
                  </div>

                  {/* Days (weekday picker) OR Day-of-month (for MONTHLY) */}
                  {isFixedMonthlyFrequency(frequency) ? (
                    <div style={{ marginBottom: '18px' }}>
                      <StepLabel text="Day of month" />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="number"
                          min={1}
                          max={28}
                          value={monthlyDay}
                          onChange={e => setMonthlyDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
                          style={{
                            width: '80px', height: '44px', padding: '0 12px', borderRadius: '8px',
                            border: '1px solid #E0E0E0', fontSize: '16px', fontWeight: 600,
                            color: '#111111', outline: 'none', textAlign: 'center',
                          }}
                        />
                        <span style={{ fontSize: '14px', color: '#5F6368' }}>of each month (1–28)</span>
                      </div>
                      <p style={{ fontSize: '12px', color: '#888888', marginTop: '6px' }}>
                        For more complex monthly patterns (e.g. 2nd &amp; 4th Tuesday), use the schedule editor on the client profile after creation.
                      </p>
                    </div>
                  ) : (
                    <div style={{ marginBottom: '18px' }}>
                      <StepLabel text="Which days?" />
                      <DayPicker selected={daysOfWeek} onChange={d => { setDaysOfWeek(d); setErrors(e => ({ ...e, daysOfWeek: '' })) }} />
                      <FieldError msg={errors.daysOfWeek} />
                    </div>
                  )}

                  {/* Arrival time */}
                  <div>
                    <StepLabel text="When should they arrive?" />
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <TogglePill label="Specific time" active={timeType === 'SPECIFIC'} onClick={() => setTimeType('SPECIFIC')} />
                      <TogglePill label="Time window" active={timeType === 'WINDOW'} onClick={() => setTimeType('WINDOW')} />
                    </div>
                    {timeType === 'SPECIFIC' ? (
                      <select
                        value={startTime}
                        onChange={e => setStartTime(e.target.value)}
                        style={{
                          height: '40px', padding: '0 12px', borderRadius: '8px',
                          border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                          backgroundColor: 'white', minWidth: '150px',
                        }}
                      >
                        <option value="">Select time</option>
                        {generateQuarterHourTimes().map(t => (
                          <option key={t} value={t}>{formatTimeLabel(t)}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '13px', color: '#888888' }}>Arrive between</span>
                        <select
                          value={startWindowBegin}
                          onChange={e => setStartWindowBegin(e.target.value)}
                          style={{
                            height: '40px', padding: '0 12px', borderRadius: '8px',
                            border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                            backgroundColor: 'white',
                          }}
                        >
                          <option value="">Start</option>
                          {generateQuarterHourTimes().map(t => (
                            <option key={t} value={t}>{formatTimeLabel(t)}</option>
                          ))}
                        </select>
                        <span style={{ color: '#BBBBBB', fontSize: '16px' }}>—</span>
                        <select
                          value={startWindowEnd}
                          onChange={e => setStartWindowEnd(e.target.value)}
                          style={{
                            height: '40px', padding: '0 12px', borderRadius: '8px',
                            border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                            backgroundColor: 'white',
                          }}
                        >
                          <option value="">End</option>
                          {generateQuarterHourTimes().map(t => (
                            <option key={t} value={t}>{formatTimeLabel(t)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* First clean on a different date (optional) */}
                  <div style={{ marginTop: '18px' }}>
                    <StepLabel text="First clean on a different date (optional)" />
                    <p style={{ fontSize: '12px', color: '#888888', marginBottom: '8px' }}>
                      Leave blank if the first visit should follow the recurring schedule you set above.
                      Use this only when you need a one-time intro or deep clean on a different day before the normal rotation starts.
                    </p>
                    <input
                      type="date"
                      value={firstCleanDate}
                      onChange={e => setFirstCleanDate(e.target.value)}
                      style={{
                        height: '40px', padding: '0 12px', borderRadius: '8px',
                        border: '1px solid #E0E0E0', fontSize: '14px', color: '#111111', outline: 'none',
                        width: '200px',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* ── STEP 4: Pricing & Cleaner ─────────────── */}
              {step === 4 && (
                <div>
                  {/* Section A: Pricing */}
                  <SectionHeading icon={DollarSign} text="What's the pricing?" />
                  <div style={{ marginBottom: '8px' }}>
                    <StepLabel text="You charge the client" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* Dollar input */}
                      <div style={{ position: 'relative' }}>
                        <span
                          style={{
                            position: 'absolute', left: '12px', top: '50%',
                            transform: 'translateY(-50%)', color: '#888888', fontSize: '15px', pointerEvents: 'none',
                          }}
                        >
                          $
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={clientRate}
                          onChange={e => { setClientRate(e.target.value); setErrors(er => ({ ...er, clientRate: '' })) }}
                          placeholder="150"
                          style={{
                            width: '120px', height: '44px', paddingLeft: '28px', paddingRight: '12px',
                            borderRadius: '8px', border: errors.clientRate ? '1px solid #E53935' : '1px solid #E0E0E0',
                            fontSize: '15px', fontWeight: 600, color: '#111111', outline: 'none',
                          }}
                        />
                      </div>
                      <FieldError msg={errors.clientRate} />
                      <TogglePill label="per clean" active={billingType === 'PER_CLEAN'} onClick={() => setBillingType('PER_CLEAN')} />
                      <TogglePill label="monthly flat" active={billingType === 'FLAT_RATE'} onClick={() => setBillingType('FLAT_RATE')} />
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ height: '1px', backgroundColor: '#EEEEEE', margin: '20px 0' }} />

                  {/* Section B: Cleaner */}
                  <SectionHeading icon={Users} text="Who cleans this location?" />
                  <div style={{ marginBottom: '12px' }}>
                    <StepLabel text="Assigned Cleaner" />
                    <select
                      value={subcontractorId}
                      onChange={e => setSubcontractorId(e.target.value)}
                      style={{
                        width: '100%', height: '44px', padding: '0 12px',
                        borderRadius: '8px', border: '1px solid #E0E0E0',
                        fontSize: '14px', color: subcontractorId ? '#111111' : '#BBBBBB',
                        backgroundColor: 'white', outline: 'none', cursor: 'pointer',
                        appearance: 'none',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23BBBBBB' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 12px center',
                        paddingRight: '36px',
                      }}
                    >
                      <option value="">Select a cleaner...</option>
                      {subcontractors.map(sub => (
                        <option key={sub.id} value={sub.id}>{sub.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <StepLabel text="What do you pay them?" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ position: 'relative' }}>
                        <span
                          style={{
                            position: 'absolute', left: '12px', top: '50%',
                            transform: 'translateY(-50%)', color: '#888888', fontSize: '15px', pointerEvents: 'none',
                          }}
                        >
                          $
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={subcontractorRate}
                          onChange={e => setSubcontractorRate(e.target.value)}
                          placeholder="100"
                          style={{
                            width: '120px', height: '44px', paddingLeft: '28px', paddingRight: '12px',
                            borderRadius: '8px', border: '1px solid #E0E0E0',
                            fontSize: '15px', fontWeight: 600, color: '#111111', outline: 'none',
                          }}
                        />
                      </div>
                      <TogglePill label="per clean" active={cleanerPayType === 'PER_CLEAN'} onClick={() => setCleanerPayType('PER_CLEAN')} />
                      <TogglePill label="monthly flat" active={cleanerPayType === 'FLAT_RATE'} onClick={() => setCleanerPayType('FLAT_RATE')} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── STEP 5: Extras (optional) ─────────────── */}
              {step === 5 && (
                <div>
                  {/* Add-on Services */}
                  <SectionHeading icon={Sparkles} text="Add-on Services" />

                  <div style={{ marginBottom: '4px' }}>
                    <StepLabel text="Quick-add a service" />
                  </div>

                  {/* Service icon tiles */}
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {QUICK_ADD_SERVICES.map(service => {
                      const isActive = addOns.some(a => a.description === service.description)
                      return (
                        <button
                          key={service.label}
                          type="button"
                          onClick={() => {
                            if (isActive) {
                              setAddOns(prev => prev.filter(a => a.description !== service.description))
                            } else {
                              addAddOn({ description: service.description, defaultFrequency: service.defaultFrequency })
                            }
                          }}
                          style={{
                            width: '64px', height: '64px', borderRadius: '8px',
                            border: isActive ? '1px solid #00A896' : '1px solid #EEEEEE',
                            backgroundColor: isActive ? 'rgba(0,168,150,0.06)' : 'white',
                            cursor: 'pointer', display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: '4px',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <span style={{ fontSize: '22px' }}>{service.icon}</span>
                          <span style={{ fontSize: '11px', color: isActive ? '#00A896' : '#888888', fontWeight: 500 }}>
                            {service.label}
                          </span>
                        </button>
                      )
                    })}
                    {/* Custom */}
                    <button
                      type="button"
                      onClick={() => addAddOn()}
                      style={{
                        width: '64px', height: '64px', borderRadius: '8px',
                        border: '1px dashed #BBBBBB', backgroundColor: 'white',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '4px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Plus style={{ width: '20px', height: '20px', color: '#BBBBBB' }} />
                      <span style={{ fontSize: '11px', color: '#BBBBBB', fontWeight: 500 }}>Custom</span>
                    </button>
                  </div>

                  {addOns.length === 0 && (
                    <p style={{ fontSize: '12px', color: '#BBBBBB', fontStyle: 'italic', marginBottom: '16px' }}>
                      Click an icon to add a recurring service
                    </p>
                  )}

                  {/* Added services list */}
                  {addOns.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      {addOns.map(addOn => (
                        <div
                          key={addOn.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px 10px', borderRadius: '8px',
                            border: '1px solid #EEEEEE', backgroundColor: 'white', marginBottom: '6px',
                          }}
                        >
                          <input
                            value={addOn.description}
                            onChange={e => updateAddOn(addOn.id, { description: e.target.value })}
                            placeholder="Service name..."
                            style={{
                              flex: 1, height: '32px', padding: '0 8px', borderRadius: '6px',
                              border: '1px solid #E0E0E0', fontSize: '13px', color: '#111111', outline: 'none',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => removeAddOn(addOn.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BBBBBB', padding: '4px' }}
                          >
                            <Trash2 style={{ width: '14px', height: '14px' }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Divider */}
                  <div style={{ height: '1px', backgroundColor: '#EEEEEE', margin: '16px 0' }} />

                  {/* Notes */}
                  <SectionHeading icon={FileText} text="Notes & Special Instructions" />
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Any special instructions, reminders, or notes about this client..."
                    style={{
                      width: '100%', height: '80px', padding: '12px',
                      borderRadius: '8px', border: '1px solid #E0E0E0',
                      fontSize: '14px', color: '#111111', outline: 'none',
                      resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                    onFocus={e => {
                      e.currentTarget.style.border = '1px solid #00A896'
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,168,150,0.08)'
                    }}
                    onBlur={e => {
                      e.currentTarget.style.border = '1px solid #E0E0E0'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  />
                </div>
              )}

            </div>
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div
          style={{
            padding: '16px 24px', borderTop: '1px solid #EEEEEE',
            flexShrink: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', backgroundColor: 'white',
          }}
        >
          {/* Left: Cancel or Back */}
          {step > 1 ? (
            <button
              onClick={goBack}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '14px', color: '#5F6368', background: 'none',
                border: 'none', cursor: 'pointer',
              }}
            >
              <ArrowLeft style={{ width: '16px', height: '16px' }} />
              Back
            </button>
          ) : (
            <button
              onClick={() => { onClose(); resetForm() }}
              style={{ fontSize: '14px', color: '#5F6368', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
          )}

          {/* Right: Next or Create */}
          {step < 5 ? (
            <button
              onClick={goNext}
              style={{
                height: '44px', padding: '0 20px', borderRadius: '8px',
                fontSize: '15px', fontWeight: 600, color: 'white',
                backgroundColor: '#00A896', border: 'none', cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#008F7E' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#00A896' }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !canCreate}
              style={{
                height: '44px', padding: '0 20px', borderRadius: '8px',
                fontSize: '15px', fontWeight: 600, color: 'white',
                backgroundColor: canCreate && !isSubmitting ? '#00A896' : '#BBBBBB',
                border: 'none',
                cursor: canCreate && !isSubmitting ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s ease',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}
              onMouseEnter={e => { if (canCreate && !isSubmitting) e.currentTarget.style.backgroundColor = '#008F7E' }}
              onMouseLeave={e => { if (canCreate && !isSubmitting) e.currentTarget.style.backgroundColor = '#00A896' }}
            >
              {isSubmitting ? (
                <>{submitProgress || 'Creating...'} <ActionSpinner size={16} color="white" /></>
              ) : (
                'Create Client ✓'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default AddClientWizard
