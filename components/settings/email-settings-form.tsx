"use client"

import { useEffect, useState } from "react"
import { Mail, Send, Eye, EyeOff, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react"
import { showSuccess, showError, showApiError } from "@/lib/toast"

type Provider = "gmail" | "resend"

interface EmailSettings {
  provider: Provider
  fromName: string
  fromEmail: string
  gmailUser: string
  testEmail: string
  enableSending: boolean
  allowRealClientEmails: boolean
  gmailAppPasswordSet: boolean
  resendApiKeySet: boolean
  hasRow: boolean
}

const TEAL = "#0D9488"
const BORDER = "#E4E4E7"

const inputCls =
  "w-full rounded-md px-3 py-2 text-[14px] text-slate-900 outline-none transition-colors focus:border-teal-500"
const inputStyle = { border: `1px solid ${BORDER}` }
const labelCls = "block text-[12px] font-semibold text-zinc-600 mb-1"

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{ background: checked ? TEAL : "#D4D4D8" }}
    >
      <span
        className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
      />
    </button>
  )
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5" style={{ border: `1px solid ${BORDER}` }}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400 mb-3">{label}</div>
      {children}
    </section>
  )
}

export function EmailSettingsForm() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const [provider, setProvider] = useState<Provider>("gmail")
  const [fromName, setFromName] = useState("")
  const [fromEmail, setFromEmail] = useState("")
  const [gmailUser, setGmailUser] = useState("")
  const [testEmail, setTestEmail] = useState("")
  const [enableSending, setEnableSending] = useState(false)
  const [allowReal, setAllowReal] = useState(false)
  // Secret inputs (empty = leave unchanged). The *Set flags reflect what's stored.
  const [gmailAppPassword, setGmailAppPassword] = useState("")
  const [resendApiKey, setResendApiKey] = useState("")
  const [gmailPwSet, setGmailPwSet] = useState(false)
  const [resendKeySet, setResendKeySet] = useState(false)

  const load = async () => {
    try {
      const res = await fetch("/api/settings/email")
      if (!res.ok) { await showApiError(res, "Failed to load email settings"); return }
      const d: EmailSettings = await res.json()
      setProvider(d.provider)
      setFromName(d.fromName || "")
      setFromEmail(d.fromEmail || "")
      setGmailUser(d.gmailUser || "")
      setTestEmail(d.testEmail || "")
      setEnableSending(d.enableSending)
      setAllowReal(d.allowRealClientEmails)
      setGmailPwSet(d.gmailAppPasswordSet)
      setResendKeySet(d.resendApiKeySet)
      setGmailAppPassword("")
      setResendApiKey("")
    } catch {
      showError("Failed to load email settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const save = async (): Promise<boolean> => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        provider, fromName, fromEmail, gmailUser, testEmail,
        enableSending, allowRealClientEmails: allowReal,
      }
      if (gmailAppPassword.trim()) payload.gmailAppPassword = gmailAppPassword
      if (resendApiKey.trim()) payload.resendApiKey = resendApiKey

      const res = await fetch("/api/settings/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { await showApiError(res, "Failed to save"); return false }
      await load()
      return true
    } catch {
      showError("Failed to save")
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (await save()) showSuccess("Email settings saved")
  }

  // Save first (so a freshly typed credential is persisted), then send the test.
  const handleTest = async () => {
    setTesting(true)
    try {
      const ok = await save()
      if (!ok) return
      const res = await fetch("/api/settings/email/test", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { showError(data?.error || "Test email failed"); return }
      showSuccess(`Test email sent to ${testEmail || "your test address"}`)
    } catch {
      showError("Test email failed")
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const credsSet = provider === "gmail" ? (gmailPwSet || !!gmailAppPassword.trim()) : (resendKeySet || !!resendApiKey.trim())

  // Status banner
  let status: { tone: string; bg: string; border: string; icon: React.ReactNode; text: string }
  if (!credsSet) {
    status = { tone: "#B91C1C", bg: "#FEF2F2", border: "#FECACA", icon: <AlertTriangle className="h-4 w-4" />, text: `No ${provider === "gmail" ? "App Password" : "API key"} set — add it below to start sending.` }
  } else if (!enableSending) {
    status = { tone: "#B45309", bg: "#FFFBEB", border: "#FDE68A", icon: <AlertTriangle className="h-4 w-4" />, text: "Sending is paused — emails are logged but not delivered." }
  } else if (!allowReal) {
    status = { tone: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE", icon: <ShieldCheck className="h-4 w-4" />, text: "Test mode — only test emails send; client emails are held back." }
  } else {
    status = { tone: "#047857", bg: "#ECFDF5", border: "#A7F3D0", icon: <ShieldCheck className="h-4 w-4" />, text: `Live — sending via ${provider === "gmail" ? "Gmail" : "Resend"} as ${fromEmail || gmailUser || "your address"}.` }
  }

  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "rgba(13,148,136,0.10)" }}>
          <Mail className="h-5 w-5" style={{ color: TEAL }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "#18181B" }}>Email</h1>
          <p className="text-[13px] text-zinc-500">Connect the account invoices are sent from.</p>
        </div>
      </div>

      {/* Status banner */}
      <div className="mb-5 flex items-center gap-2 rounded-lg px-4 py-3 text-[13px] font-medium"
        style={{ background: status.bg, border: `1px solid ${status.border}`, color: status.tone }}>
        {status.icon}
        <span>{status.text}</span>
      </div>

      <div className="space-y-4">
        {/* Provider */}
        <Card label="Provider">
          <div className="inline-flex rounded-lg p-0.5" style={{ border: `1px solid ${BORDER}`, background: "#F4F4F5" }}>
            {(["gmail", "resend"] as Provider[]).map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className="px-4 py-1.5 text-[13px] font-semibold rounded-md transition-colors"
                style={provider === p ? { background: "#FFFFFF", color: "#18181B", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: "#71717A" }}
              >
                {p === "gmail" ? "Gmail / Workspace" : "Resend"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-zinc-500">
            {provider === "gmail"
              ? "Sends through Google with an App Password. Requires 2-Step Verification on the account."
              : "Sends through Resend's API. Requires a domain verified in your Resend dashboard."}
          </p>
        </Card>

        {/* Sender identity */}
        <Card label="Sender">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>From name</label>
              <input className={inputCls} style={inputStyle} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="The Clean Freaks" />
            </div>
            <div>
              <label className={labelCls}>From email</label>
              <input className={inputCls} style={inputStyle} value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="invoicing@thecleanfreaks.co" />
            </div>
          </div>
          <p className="mt-2 text-[12px] text-zinc-500">The address clients see in the “From” line.{provider === "resend" ? " Must be on your verified Resend domain." : ""}</p>
        </Card>

        {/* Credentials */}
        {provider === "gmail" ? (
          <Card label="Gmail credentials">
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Login email (username)</label>
                <input className={inputCls} style={inputStyle} value={gmailUser} onChange={(e) => setGmailUser(e.target.value)} placeholder="admin@thecleanfreaks.co" />
                <p className="mt-1 text-[12px] text-zinc-500">The Google account the App Password belongs to (often the same as From email).</p>
              </div>
              <div>
                <label className={labelCls}>App Password</label>
                <div className="relative">
                  <input
                    className={inputCls + " pr-10 font-mono"}
                    style={inputStyle}
                    type={showSecret ? "text" : "password"}
                    value={gmailAppPassword}
                    onChange={(e) => setGmailAppPassword(e.target.value)}
                    placeholder={gmailPwSet ? "•••••••••••••••• (saved — leave blank to keep)" : "abcd efgh ijkl mnop"}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-[12px] text-zinc-500">
                  Google Account → Security → 2-Step Verification → App passwords. Spaces are fine; they’re stripped automatically.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <Card label="Resend credentials">
            <label className={labelCls}>API key</label>
            <div className="relative">
              <input
                className={inputCls + " pr-10 font-mono"}
                style={inputStyle}
                type={showSecret ? "text" : "password"}
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                placeholder={resendKeySet ? "•••••••••••••••• (saved — leave blank to keep)" : "re_xxxxxxxxxxxxxxxx"}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-[12px] text-zinc-500">From the Resend dashboard → API Keys.</p>
          </Card>
        )}

        {/* Sending controls */}
        <Card label="Sending">
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Test email address</label>
              <input className={inputCls} style={inputStyle} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" />
              <p className="mt-1 text-[12px] text-zinc-500">Where the “Send test” button delivers.</p>
            </div>

            <div className="flex items-center justify-between gap-4 border-t pt-4" style={{ borderColor: BORDER }}>
              <div>
                <p className="text-[14px] font-semibold text-slate-800">Enable sending</p>
                <p className="text-[12px] text-zinc-500">Master switch. Off = emails are logged but never delivered.</p>
              </div>
              <Switch checked={enableSending} onChange={setEnableSending} />
            </div>

            <div className="flex items-center justify-between gap-4 border-t pt-4" style={{ borderColor: BORDER }}>
              <div>
                <p className="text-[14px] font-semibold text-slate-800">Send to real clients</p>
                <p className="text-[12px] text-zinc-500">Safety lock. Off = only test emails go out; client invoices are held.</p>
              </div>
              <Switch checked={allowReal} onChange={setAllowReal} disabled={!enableSending} />
            </div>
          </div>
        </Card>
      </div>

      {/* Footer actions */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          onClick={handleTest}
          disabled={saving || testing}
          className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50"
          style={{ border: `1px solid ${BORDER}`, color: "#52525B", background: "#FFFFFF" }}
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {testing ? "Sending…" : "Save & send test"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || testing}
          className="inline-flex items-center gap-2 rounded-md px-5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: TEAL }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  )
}
