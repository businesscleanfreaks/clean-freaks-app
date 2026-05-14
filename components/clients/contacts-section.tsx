"use client"

import { useState } from "react"
import useSWR from "swr"
import { Plus, Pencil, Trash2, Star, Loader2, X, Mail, Phone, Check } from "lucide-react"
import { showError, showSuccess } from "@/lib/toast"
import { fetcher } from "@/lib/fetcher"

interface ClientContact {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string
  isPrimary: boolean
  notes: string | null
}

const ROLES = ["OWNER", "DAY_TO_DAY", "COMMUNICATION", "INVOICING", "GENERAL"] as const
const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  DAY_TO_DAY: "Day-to-Day",
  COMMUNICATION: "Communication",
  INVOICING: "Invoicing",
  GENERAL: "General",
}
const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  OWNER: { bg: "#FEF3C7", text: "#D97706" },
  DAY_TO_DAY: { bg: "#FDF2F8", text: "#DB2777" },
  COMMUNICATION: { bg: "#F0FDF4", text: "#059669" },
  INVOICING: { bg: "#EFF6FF", text: "#2563EB" },
  GENERAL: { bg: "#F3F4F6", text: "#6B7280" },
}

function RolePill({ role }: { role: string }) {
  const colors = ROLE_COLORS[role] || ROLE_COLORS.GENERAL
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: colors.bg, color: colors.text }}
    >
      {ROLE_LABELS[role] || role}
    </span>
  )
}

function ContactCard({
  contact,
  clientId,
  onMutate,
}: {
  contact: ClientContact
  clientId: string
  onMutate: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [settingPrimary, setSettingPrimary] = useState(false)
  const [form, setForm] = useState({
    name: contact.name,
    email: contact.email || "",
    phone: contact.phone || "",
    role: contact.role,
    notes: contact.notes || "",
  })

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      setEditing(false)
      onMutate()
      showSuccess("Contact updated")
    } catch {
      showError("Failed to update contact")
    } finally {
      setSaving(false)
    }
  }

  const togglePrimary = async () => {
    setSettingPrimary(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: !contact.isPrimary, role: contact.role }),
      })
      if (!res.ok) throw new Error()
      onMutate()
    } catch {
      showError("Failed to update")
    } finally {
      setSettingPrimary(false)
    }
  }

  const deleteContact = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts/${contact.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      onMutate()
      showSuccess("Contact removed")
    } catch {
      showError("Failed to delete")
    } finally {
      setDeleting(false)
    }
  }

  if (editing) {
    return (
      <div className="bg-white rounded-xl border border-teal-200 p-4 shadow-sm">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Role</label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  onClick={() => setForm({ ...form, role: r })}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                  style={
                    form.role === r
                      ? { background: ROLE_COLORS[r].bg, color: ROLE_COLORS[r].text, borderColor: ROLE_COLORS[r].text }
                      : { background: "#F9FAFB", color: "#9CA3AF", borderColor: "#E5E7EB" }
                  }
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
              <button
                onClick={() => setForm({ ...form, role: !ROLES.includes(form.role as typeof ROLES[number]) ? form.role : "" })}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={
                  !ROLES.includes(form.role as typeof ROLES[number])
                    ? { background: "#F5F3FF", color: "#7C3AED", borderColor: "#7C3AED" }
                    : { background: "#F9FAFB", color: "#9CA3AF", borderColor: "#E5E7EB" }
                }
              >
                Custom
              </button>
            </div>
            {!ROLES.includes(form.role as typeof ROLES[number]) && (
              <input
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="Type a custom role..."
                className="w-full h-9 px-3 mt-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Notes (optional)</label>
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={save}
            disabled={saving || !form.name.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "#00C9A7" }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save
          </button>
          <button onClick={() => setEditing(false)} className="text-sm text-gray-400 px-2">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (confirmDelete) {
    return (
      <div className="bg-red-50 rounded-xl border border-red-200 p-4 flex items-center justify-between">
        <p className="text-sm text-red-700 font-medium">Remove {contact.name}?</p>
        <div className="flex gap-2">
          <button
            onClick={deleteContact}
            disabled={deleting}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
          >
            {deleting ? "Removing..." : "Remove"}
          </button>
          <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 px-2">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 group hover:shadow-md transition-all duration-150 relative">
      {/* Primary star */}
      <button
        onClick={togglePrimary}
        disabled={settingPrimary}
        title={contact.isPrimary ? "Primary contact" : "Set as primary"}
        className="absolute top-3 right-10 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
      >
        {settingPrimary ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
        ) : (
          <Star
            className="w-3.5 h-3.5"
            fill={contact.isPrimary ? "#F59E0B" : "none"}
            stroke={contact.isPrimary ? "#F59E0B" : "#D1D5DB"}
          />
        )}
      </button>

      {/* Action icons */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setEditing(true)}
          className="w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center"
        >
          <Pencil className="w-3 h-3 text-gray-400" />
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-6 h-6 rounded-md hover:bg-red-50 flex items-center justify-center"
        >
          <Trash2 className="w-3 h-3 text-red-400" />
        </button>
      </div>

      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ background: ROLE_COLORS[contact.role]?.text || "#6B7280" }}>
          {contact.name.slice(0, 2).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-semibold text-gray-900 text-sm truncate">{contact.name}</p>
            {contact.isPrimary && (
              <Star className="w-3 h-3 flex-shrink-0" fill="#F59E0B" stroke="#F59E0B" />
            )}
          </div>
          <RolePill role={contact.role} />
          {contact.email && (
            <div className="flex items-center gap-1 mt-1.5">
              <Mail className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <a href={`mailto:${contact.email}`} className="text-xs text-gray-500 hover:text-teal-600 truncate">
                {contact.email}
              </a>
            </div>
          )}
          {contact.phone && (
            <div className="flex items-center gap-1 mt-0.5">
              <Phone className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-500">{contact.phone}</span>
            </div>
          )}
          {contact.notes && (
            <p className="text-xs text-gray-400 mt-1 italic">{contact.notes}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function AddContactSheet({
  clientId,
  onSave,
  onClose,
}: {
  clientId: string
  onSave: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "COMMUNICATION",
    notes: "",
    isPrimary: false,
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      onSave()
      showSuccess("Contact added")
    } catch {
      showError("Failed to add contact")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h3 className="text-base font-bold text-gray-900">Add Contact</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Name *</label>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Georgia Lawrence"
                className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="georgia@company.com"
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Phone</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="(310) 555-0100"
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 mb-2 block">Role</label>
              <div className="grid grid-cols-3 gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setForm({ ...form, role: r })}
                    className="py-2 rounded-xl text-xs font-semibold border transition-all text-center"
                    style={
                      form.role === r
                        ? { background: ROLE_COLORS[r].bg, color: ROLE_COLORS[r].text, borderColor: ROLE_COLORS[r].text }
                        : { background: "#F9FAFB", color: "#9CA3AF", borderColor: "#E5E7EB" }
                    }
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
                <button
                  onClick={() => setForm({ ...form, role: !ROLES.includes(form.role as typeof ROLES[number]) ? form.role : "" })}
                  className="py-2 rounded-xl text-xs font-semibold border transition-all text-center"
                  style={
                    !ROLES.includes(form.role as typeof ROLES[number])
                      ? { background: "#F5F3FF", color: "#7C3AED", borderColor: "#7C3AED" }
                      : { background: "#F9FAFB", color: "#9CA3AF", borderColor: "#E5E7EB" }
                  }
                >
                  Custom
                </button>
              </div>
              {!ROLES.includes(form.role as typeof ROLES[number]) && (
                <input
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="Type a custom role..."
                  className="w-full h-10 px-3 mt-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Notes (optional)</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Best contact for scheduling"
                className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isPrimary}
                onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-gray-600">Set as primary for this role</span>
            </label>
          </div>
        </div>

        <div className="flex gap-2 flex-shrink-0 px-6 pb-6 pt-4 border-t border-gray-100">
          <button
            onClick={save}
            disabled={saving || !form.name.trim()}
            className="flex-1 h-10 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
            style={{ background: "#00C9A7" }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? "Adding..." : "Add Contact"}
          </button>
          <button onClick={onClose} className="px-4 h-10 rounded-xl text-sm text-gray-500 border border-gray-200 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export function ContactsSection({ clientId }: { clientId: string }) {
  const { data, mutate, isLoading } = useSWR(`/api/clients/${clientId}/contacts`, fetcher)
  const contacts: ClientContact[] = data?.contacts || []
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Contacts</h3>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border transition-all hover:shadow-sm"
          style={{ color: "#00C9A7", borderColor: "#00C9A7" }}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Contact
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
        </div>
      ) : contacts.length === 0 ? (
        <div
          className="flex flex-col items-center py-8 text-center rounded-xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-teal-300 hover:bg-teal-50/30 transition-all"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="w-5 h-5 text-gray-300 mb-1" />
          <p className="text-xs text-gray-400">No contacts yet — add one</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contacts.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              clientId={clientId}
              onMutate={() => mutate()}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddContactSheet
          clientId={clientId}
          onSave={() => { mutate(); setShowAdd(false) }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
