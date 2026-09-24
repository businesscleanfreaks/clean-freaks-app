"use client"

import { useEffect, useRef, useState } from "react"
import { ScheduleForm, type ScheduleRecord } from "../schedule-form"
import { RecurringAddonForm } from "../recurring-addon-form"
import { AddOnCard } from "../add-on-card"
import type { ClientDetailState } from "../use-client-detail"
import type { BillingType, ClientLocation, ClientSchedule } from "../client-detail-types"
import { getScheduleLifecycle } from "@/lib/schedule-timing"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import {
  accessSavePayload,
  arrivalInfo,
  copyForCleaner,
  rateText,
  readAccess,
  scheduleHeadline,
  shortDay,
  type Access,
} from "@/lib/client-profile"
import { showApiError, showError, showSuccess } from "@/lib/toast"
import { AddButton, C, Field, LinkAction, Modal, SectionLabel } from "./ui"

/**
 * Locations (Client Profile Main.dc.html · LOCATIONS): one section per
 * location, a name bar, then a Schedule cell per running schedule and a
 * Getting in cell. Every cell opens its editor.
 */

export const cleanerHex = (name: string | null | undefined) =>
  getCleanerColorInfo(name && name !== "Unassigned" && name !== "Mixed" ? name : null).hex
const toDay = (v: Date | string) => new Date(v)

type ScheduleEditorState =
  | { locationId: string; schedule: ClientSchedule }
  | { locationId: string; schedule: null }

export function LocationsCard({
  state,
  today,
  onAddBreak,
  autoBook,
}: {
  state: ClientDetailState
  today: Date
  onAddBreak: (scheduleId: string) => void
  /** "Book first clean" from the Add Client modal: open the first schedule editor. */
  autoBook: boolean
}) {
  const { client } = state
  const [locationEditor, setLocationEditor] = useState<{ id: string | null; name: string; address: string } | null>(null)
  const [accessEditor, setAccessEditor] = useState<ClientLocation | null>(null)
  const [scheduleEditor, setScheduleEditor] = useState<ScheduleEditorState | null>(null)

  const booked = useRef(false)
  useEffect(() => {
    if (!autoBook || booked.current) return
    booked.current = true
    const first = client.locations[0]
    if (first) setScheduleEditor({ locationId: first.id, schedule: null })
    else setLocationEditor({ id: null, name: client.name, address: "" })
  }, [autoBook, client.locations, client.name])

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.mintBorder}`, borderRadius: 14, marginTop: 6, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", background: C.mint }}>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", color: C.mintTitle }}>
          Locations{client.locations.length > 1 ? ` · ${client.locations.length}` : ""}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <AddButton label="Add Location" onClick={() => setLocationEditor({ id: null, name: "", address: "" })} />
        </span>
      </div>

      {client.locations.length === 0 && (
        <div style={{ borderTop: `1px solid ${C.mintBorder}`, padding: "16px 20px", fontSize: 13, color: C.sub }}>
          No locations yet. Add the address the cleaners go to, then set up its schedule.
        </div>
      )}

      {client.locations.map(location => (
        <LocationSection
          key={location.id}
          location={location}
          today={today}
          onEditLocation={() => setLocationEditor({ id: location.id, name: location.name, address: location.address })}
          onEditAccess={() => setAccessEditor(location)}
          onEditSchedule={schedule => setScheduleEditor({ locationId: location.id, schedule })}
          onAddBreak={onAddBreak}
        />
      ))}

      {locationEditor && (
        <LocationEditor
          state={state}
          initial={locationEditor}
          onClose={() => setLocationEditor(null)}
        />
      )}
      {accessEditor && (
        <AccessEditor state={state} location={accessEditor} onClose={() => setAccessEditor(null)} />
      )}
      {scheduleEditor && (
        <ScheduleEditor
          state={state}
          editor={scheduleEditor}
          onClose={() => setScheduleEditor(null)}
        />
      )}
    </div>
  )
}

function runningSchedules(location: ClientLocation, today: Date): ClientSchedule[] {
  return (location.schedules || [])
    .filter(s => s.isActive && getScheduleLifecycle(s, today) !== "ended")
    .sort((a, b) => toDay(a.startDate).getTime() - toDay(b.startDate).getTime())
}

function nextJobAt(location: ClientLocation, today: Date) {
  return (location.jobs || [])
    .filter(j => j.status !== "CANCELLED" && toDay(j.date) >= new Date(today.getTime() - 12 * 3600e3))
    .sort((a, b) => toDay(a.date).getTime() - toDay(b.date).getTime())[0]
}

function LocationSection({
  location,
  today,
  onEditLocation,
  onEditAccess,
  onEditSchedule,
  onAddBreak,
}: {
  location: ClientLocation
  today: Date
  onEditLocation: () => void
  onEditAccess: () => void
  onEditSchedule: (schedule: ClientSchedule | null) => void
  onAddBreak: (scheduleId: string) => void
}) {
  const running = runningSchedules(location, today)
  const cleaner = running.map(s => s.subcontractor?.name).find(Boolean) ?? "Unassigned"
  const access = readAccess(location)
  const hasAccess = !!(access.gettingIn || access.notes)
  const next = nextJobAt(location, today)
  const accessNote = next
    ? next.subcontractor?.name
      ? `${next.subcontractor.name} cleans here ${shortDay(next.date)}.`
      : `Next clean ${shortDay(next.date)}.`
    : "Add it before the first clean."

  // A break covering today, from any interval at this location.
  const onBreak = (location.schedules || []).find(s =>
    s.pauseFrom && toDay(s.pauseFrom) <= today && (!s.pauseTo || toDay(s.pauseTo) >= new Date(today.getTime() - 12 * 3600e3)),
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyForCleaner(location.name, location.address, access))
      showSuccess("Copied for cleaner")
    } catch {
      showError("Couldn't copy. Select the text and copy it instead.")
    }
  }

  return (
    <div style={{ borderTop: `1px solid ${C.mintBorder}` }}>
      <div
        className="cfp-tint"
        onClick={onEditLocation}
        title="Edit location name & address"
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: `1px solid ${C.border}`, background: "#fff" }}
      >
        <span style={{ width: 40, height: 40, borderRadius: 10, background: "#14352b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{location.name}</div>
          <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{location.address}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#f6f7f9", border: "1px solid #eef1f4", borderRadius: 999, padding: "4px 11px 4px 6px", flex: "none", maxWidth: "40%" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: cleanerHex(cleaner), flex: "none" }} />
          <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cleaner}</span>
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.teal, flex: "none" }}>Edit</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))" }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          {running.length === 0 ? (
            <div className="cfp-tint" onClick={() => onEditSchedule(null)} style={{ padding: "14px 20px", boxShadow: `inset -1px 0 ${C.hair}, inset 0 -1px ${C.hair}`, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <SectionLabel>Schedule</SectionLabel>
                <LinkAction onClick={() => onEditSchedule(null)}>Set Up</LinkAction>
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 10 }}>No schedule yet</div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 12.5, color: C.sub }}>
                <ArrivalTag tag="Set up" bg={C.amberBg} fg={C.amber} />
                <span>Pick days, arrival and cleaner</span>
              </div>
            </div>
          ) : (
            running.map(s => (
              <ScheduleCell
                key={s.id}
                schedule={s}
                today={today}
                onBreakUntil={onBreak ? (onBreak.pauseTo ? shortDay(onBreak.pauseTo) : "further notice") : null}
                onEdit={() => onEditSchedule(s)}
                onAddBreak={() => onAddBreak(s.id)}
              />
            ))
          )}
        </div>

        <div className="cfp-tint" onClick={onEditAccess} title="Edit access info" style={{ padding: "14px 20px", minWidth: 0 }}>
          {hasAccess ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <SectionLabel>Getting in</SectionLabel>
                <div style={{ display: "flex", gap: 12 }}>
                  <LinkAction onClick={copy}>Copy for Cleaner</LinkAction>
                  <LinkAction onClick={onEditAccess}>Edit</LinkAction>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, lineHeight: 1.45, marginTop: 8 }}>
                {access.gettingIn && <div style={{ overflowWrap: "anywhere", whiteSpace: "pre-line" }}>{access.gettingIn}</div>}
                {access.notes && <div style={{ overflowWrap: "anywhere", whiteSpace: "pre-line", color: C.sub }}>{access.notes}</div>}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12, height: "100%" }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5 }}>
                <b style={{ color: C.amber }}>No way in on file.</b> <span style={{ color: C.sub }}>{accessNote}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: C.amber, padding: "8px 13px", borderRadius: 8, flex: "none" }}>Add Entry Info</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ArrivalTag({ tag, bg, fg }: { tag: string; bg: string; fg: string }) {
  return (
    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, background: bg, color: fg, flex: "none" }}>{tag}</span>
  )
}

function ScheduleCell({
  schedule,
  today,
  onBreakUntil,
  onEdit,
  onAddBreak,
}: {
  schedule: ClientSchedule
  today: Date
  onBreakUntil: string | null
  onEdit: () => void
  onAddBreak: () => void
}) {
  const arrival = arrivalInfo(schedule)
  const lifecycle = getScheduleLifecycle(schedule, today)
  // After a change made going forward, both halves are running: say which is which.
  const span = lifecycle === "upcoming"
    ? `From ${shortDay(schedule.startDate)}`
    : schedule.endDate ? `Until ${shortDay(schedule.endDate)}` : null

  return (
    <div className="cfp-tint" onClick={onEdit} title="Edit schedule" style={{ padding: "14px 20px", boxShadow: `inset -1px 0 ${C.hair}, inset 0 -1px ${C.hair}`, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SectionLabel>Schedule</SectionLabel>
          {span && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.teal, background: C.hoverTint, padding: "1px 7px", borderRadius: 5 }}>{span}</span>}
        </span>
        <div style={{ display: "flex", gap: 12 }}>
          <LinkAction onClick={onAddBreak}>Add a Break</LinkAction>
          <LinkAction onClick={onEdit}>Edit</LinkAction>
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 10, lineHeight: 1.3, letterSpacing: "-0.01em" }}>{scheduleHeadline(schedule)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 12.5, color: C.sub }}>
        <ArrivalTag tag={arrival.tag} bg={arrival.bg} fg={arrival.fg} />
        <span>{arrival.line}</span>
      </div>
      {onBreakUntil && (
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: C.amber }}>On a break until {onBreakUntil}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "3px 16px", marginTop: 12, paddingTop: 10, borderTop: "1px solid #f1ece2", fontSize: 12.5, justifyContent: "start", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: C.muted }}>Client</span>
        <span style={{ fontWeight: 800, fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>{rateText(schedule.defaultClientRate, schedule.clientPayType)}</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: C.muted }}>Cleaner</span>
        <span style={{ fontWeight: 700, color: C.sub, fontVariantNumeric: "tabular-nums" }}>
          {rateText(schedule.defaultSubcontractorRate, schedule.subcontractorPayType)}
          {schedule.subcontractor?.name ? ` · ${schedule.subcontractor.name}` : ""}
        </span>
      </div>
      {(schedule.recurringAddOnServices?.length ?? 0) > 0 && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: C.muted }}>
          + {schedule.recurringAddOnServices.map(a => a.description).join(", ")}
        </div>
      )}
    </div>
  )
}

// ── Editors ────────────────────────────────────────────────────────────────

function LocationEditor({
  state,
  initial,
  onClose,
}: {
  state: ClientDetailState
  initial: { id: string | null; name: string; address: string }
  onClose: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [address, setAddress] = useState(initial.address)
  const [saving, setSaving] = useState(false)
  const canSave = name.trim() && address.trim() && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const res = initial.id
        ? await fetch(`/api/locations/${initial.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim(), address: address.trim() }),
          })
        : await fetch(`/api/locations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId: state.client.id, name: name.trim(), address: address.trim() }),
          })
      if (!res.ok) {
        await showApiError(res, "Couldn't save the location")
        return
      }
      showSuccess(initial.id ? "Location saved" : "Location added")
      state.onDataChange?.()
      onClose()
    } catch {
      showError("Couldn't save the location")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!initial.id) return
    await state.handleDeleteLocation(initial.id)
    onClose()
  }

  return (
    <Modal
      title={initial.id ? "Edit location" : "Add location"}
      onClose={onClose}
      footer={
        <>
          {initial.id && <button className="cfp-btn danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>}
          <button className="cfp-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cfp-btn primary" disabled={!canSave} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Name">
          <input autoFocus className="cfp-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main office" />
        </Field>
        <Field label="Address">
          <input className="cfp-input" value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, state and zip" />
        </Field>
      </div>
    </Modal>
  )
}

function AccessEditor({ state, location, onClose }: { state: ClientDetailState; location: ClientLocation; onClose: () => void }) {
  const [access, setAccess] = useState<Access>(() => readAccess(location))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/locations/${location.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accessSavePayload(access)),
      })
      if (!res.ok) {
        await showApiError(res, "Couldn't save the access info")
        return
      }
      showSuccess("Access info saved")
      state.onDataChange?.()
      onClose()
    } catch {
      showError("Couldn't save the access info")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Getting in · ${location.name}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="cfp-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cfp-btn primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Getting in">
          <textarea
            autoFocus
            className="cfp-input"
            rows={4}
            value={access.gettingIn}
            onChange={e => setAccess(a => ({ ...a, gettingIn: e.target.value }))}
            placeholder="Door, codes, alarm, gate, lockbox, parking"
            style={{ resize: "vertical", lineHeight: 1.45 }}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="cfp-input"
            rows={2}
            value={access.notes}
            onChange={e => setAccess(a => ({ ...a, notes: e.target.value }))}
            placeholder="Anything else the cleaner should know here"
            style={{ resize: "vertical", lineHeight: 1.45 }}
          />
        </Field>
      </div>
    </Modal>
  )
}

function ScheduleEditor({ state, editor, onClose }: { state: ClientDetailState; editor: ScheduleEditorState; onClose: () => void }) {
  const { client } = state
  const [mode, setMode] = useState<"future" | "edit">("future")
  const [addingAddon, setAddingAddon] = useState(false)
  const done = () => {
    state.onDataChange?.()
    onClose()
  }
  const location = client.locations.find(l => l.id === editor.locationId)
  const schedule = editor.schedule
  const siblings = client.locations.flatMap(l => (l.schedules || []).filter(s => s.isActive).map(s => s.id))

  return (
    <Modal title={schedule ? `Schedule · ${location?.name ?? ""}` : `Set up a schedule · ${location?.name ?? ""}`} onClose={onClose} width={620}>
      {schedule && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {([
            ["future", "Change going forward"],
            ["edit", "Fix a mistake"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              style={{
                flex: 1, fontSize: 12.5, fontWeight: 700, padding: "8px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${mode === key ? C.primary : "#e6dfd1"}`,
                background: mode === key ? C.hoverTint : "#fff",
                color: mode === key ? C.teal : C.sub,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {schedule && (
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.45, marginBottom: 12 }}>
          {mode === "future"
            ? "New price, days, time or cleaner from a date you pick. Earlier cleans, invoices and pay stay exactly as they were."
            : "Corrects the schedule as it was entered. Cleans already invoiced or paid are left alone."}
        </div>
      )}
      <ScheduleForm
        key={`${schedule?.id ?? "new"}-${mode}`}
        embedded
        locationId={editor.locationId}
        clientBillingType={client.billingType as BillingType}
        clientCleanerPayType={(client.cleanerPayType || "PER_CLEAN") as BillingType}
        schedule={schedule ? ({ ...schedule, locationId: editor.locationId } as unknown as ScheduleRecord) : undefined}
        mode={schedule ? mode : "create"}
        onSuccess={done}
        onCancel={onClose}
      />

      {schedule && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.hair}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <SectionLabel>Recurring add-ons</SectionLabel>
            {!addingAddon && <AddButton small label="Add Add-on" onClick={() => setAddingAddon(true)} />}
          </div>
          {(schedule.recurringAddOnServices || []).length === 0 && !addingAddon && (
            <div style={{ fontSize: 12.5, color: C.muted }}>None.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(schedule.recurringAddOnServices || []).map(addon => (
              <AddOnCard key={addon.id} addOn={{ ...addon, isRecurring: true }} onDelete={() => state.onDataChange?.()} />
            ))}
          </div>
          {addingAddon && (
            <div style={{ marginTop: 8 }}>
              <RecurringAddonForm
                scheduleId={schedule.id}
                siblingScheduleIds={siblings.filter(id => id !== schedule.id)}
                onSuccess={() => { setAddingAddon(false); state.onDataChange?.() }}
                onCancel={() => setAddingAddon(false)}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              className="cfp-btn ghost"
              onClick={async () => { await state.handleToggleSchedulePause(schedule.id, true); onClose() }}
            >
              Stop this schedule
            </button>
            <button
              className="cfp-btn danger"
              onClick={async () => { await state.handleDeleteSchedule(schedule.id); onClose() }}
            >
              Delete schedule
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
