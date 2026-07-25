"use client"

import { useEffect, useState } from "react"
import { Plus, Loader2, X } from "lucide-react"
import { showSuccess, showError } from "@/lib/toast"
import { initialsOf, MIN_PASSWORD_LENGTH } from "@/lib/team"

interface TeamUser {
  id: string
  email: string
  name: string | null
  createdAt: string
}

// Stable per-person avatar tint so teammates are easy to tell apart.
const AVATAR_COLORS = ["#0b7a4e", "#8b5cf6", "#2a6fdb", "#c2410c", "#0f8a6e", "#b0821f"]
function avatarColor(id: string): string {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]
}

const inputCls =
  "w-full rounded-[9px] border border-[#dededa] bg-white px-[13px] py-[10px] text-[14px] text-[#0d0d0e] outline-none transition-colors focus:border-[#0b7a4e] focus:ring-2 focus:ring-[#0b7a4e]/15"
const labelCls = "mb-1.5 block text-[13px] font-bold text-[#0d0d0e]"

export function TeamForm() {
  const [users, setUsers] = useState<TeamUser[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch("/api/settings/team")
      if (!res.ok) throw new Error("Failed to load team")
      const data = await res.json()
      setUsers(data.users ?? [])
      setCurrentUserId(data.currentUserId ?? null)
    } catch {
      showError("Failed to load team")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const resetForm = () => {
    setName("")
    setEmail("")
    setPassword("")
    setFormOpen(false)
  }

  const addTeammate = async () => {
    setSubmitting(true)
    try {
      const res = await fetch("/api/settings/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to add teammate")
      showSuccess(`${name.trim()} can now sign in`)
      resetForm()
      await load()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to add teammate")
    } finally {
      setSubmitting(false)
    }
  }

  const removeTeammate = async (id: string) => {
    setRemovingId(id)
    try {
      const res = await fetch(`/api/settings/team/${id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to remove teammate")
      showSuccess("Teammate removed")
      setConfirmingId(null)
      await load()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to remove teammate")
    } finally {
      setRemovingId(null)
    }
  }

  const header = (
    <div className="mb-[26px]">
      <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">Team</h1>
      <div className="mt-[5px] text-[13.5px] text-[#6b6f73]">
        People who can log in and run the business with you.
      </div>
    </div>
  )

  if (loading) {
    return (
      <div>
        {header}
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}

      {/* Team list */}
      <div className="overflow-hidden rounded-[14px] border border-[#e9e9e6] bg-white">
        {users.map((u, i) => {
          const isYou = u.id === currentUserId
          const confirming = confirmingId === u.id
          return (
            <div
              key={u.id}
              className={`flex items-center gap-[14px] px-5 py-4 ${i > 0 ? "border-t border-[#f2f2ef]" : ""}`}
            >
              <span
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-[14px] font-extrabold text-white"
                style={{ background: avatarColor(u.id) }}
              >
                {initialsOf(u.name, u.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-bold">
                  {u.name || u.email}
                  {isYou && <span className="font-semibold text-[#7e8489]"> (you)</span>}
                </div>
                <div className="mt-px truncate text-[12.5px] text-[#7e8489]">{u.email}</div>
              </div>

              {isYou ? (
                <span className="flex-none rounded-full bg-[#eef6f1] px-[11px] py-[5px] text-[12px] font-bold text-[#0b7a4e]">
                  You
                </span>
              ) : confirming ? (
                <div className="flex flex-none items-center gap-2">
                  <span className="text-[12.5px] text-[#7e8489]">Remove?</span>
                  <button
                    type="button"
                    onClick={() => removeTeammate(u.id)}
                    disabled={removingId === u.id}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#b91c1c] px-3 py-1.5 text-[12.5px] font-bold text-white transition-colors hover:bg-[#991b1b] disabled:opacity-50"
                  >
                    {removingId === u.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Yes, remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    disabled={removingId === u.id}
                    className="rounded-[8px] border border-[#e2e2df] px-3 py-1.5 text-[12.5px] font-bold text-[#55585c] transition-colors hover:bg-[#f7f7f5]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingId(u.id)}
                  className="flex-none rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-bold text-[#7e8489] transition-colors hover:bg-[#fdecec] hover:text-[#b91c1c]"
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Add teammate */}
      {formOpen ? (
        <div className="mt-[14px] rounded-[14px] border border-[#e9e9e6] bg-white px-6 py-[22px]">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[14px] font-bold">Add a teammate</div>
            <button
              type="button"
              onClick={resetForm}
              aria-label="Cancel adding a teammate"
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-[14px]">
            <div>
              <label className={labelCls} htmlFor="team-name">Name</label>
              <input
                id="team-name"
                type="text"
                className={inputCls}
                placeholder="Grace"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="team-email">Email</label>
              <input
                id="team-email"
                type="email"
                autoComplete="off"
                className={inputCls}
                placeholder="grace@thecleanfreaks.co"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="mt-[7px] text-[12px] text-[#7e8489]">They&apos;ll sign in with this email.</div>
            </div>
            <div>
              <label className={labelCls} htmlFor="team-password">Starting password</label>
              <input
                id="team-password"
                type="password"
                autoComplete="new-password"
                className={inputCls}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="mt-[7px] text-[12px] text-[#7e8489]">
                Share this with them directly. They can change it later under their own account settings.
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={addTeammate}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-[9px] bg-[#0b7a4e] px-4 py-[10px] text-[13px] font-bold text-white transition-colors hover:bg-[#0a6a44] disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Add teammate
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={submitting}
              className="rounded-[9px] border border-[#e2e2df] bg-white px-4 py-[10px] text-[13px] font-bold text-[#55585c] transition-colors hover:bg-[#f7f7f5] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="mt-[14px] inline-flex items-center gap-2 rounded-[9px] border border-[#d6e8de] bg-[#eef6f1] px-4 py-[11px] text-[13px] font-bold text-[#0b7a4e] transition-colors hover:bg-[#e4f0e9]"
        >
          <Plus className="h-[15px] w-[15px]" strokeWidth={2.2} />
          Add someone
        </button>
      )}

      <div className="mt-[14px] text-[12.5px] leading-relaxed text-[#7e8489]">
        Everyone on the team can see and do everything.
      </div>
    </div>
  )
}
