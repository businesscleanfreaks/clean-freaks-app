"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Shared editable message for one invoice candidate.
 *
 * The "Client will receive" pane and the compose window are on screen at the
 * same time and must show the same text — the design says edits in the preview
 * carry into the compose window verbatim. React state alone would let the two
 * drift, so the value lives in localStorage (matching the composer's existing
 * draft key) with a tiny in-page subscription so both update live.
 */

const DRAFT_KEY = (candidateId: string) => `cf-invoice-draft-${candidateId}`

type Listener = (message: string) => void
const listeners = new Map<string, Set<Listener>>()

/** The whole locally-saved compose draft for one candidate. */
export interface ComposeDraft {
  to: string[]
  cc: string
  subject: string
  message: string
  payNow: boolean
}

/**
 * Reads the saved draft. Returns null when nothing is saved or the stored shape
 * is not one we recognise, so a stale or hand-edited entry can never leave the
 * compose window half-filled.
 */
export function loadComposeDraft(candidateId: string): ComposeDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(candidateId))
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || !Array.isArray(d.to)) return null
    return {
      to: d.to.filter((x: unknown): x is string => typeof x === "string"),
      cc: typeof d.cc === "string" ? d.cc : "",
      subject: typeof d.subject === "string" ? d.subject : "",
      message: typeof d.message === "string" ? d.message : "",
      payNow: d.payNow !== false,
    }
  } catch {
    return null
  }
}

export function saveComposeDraft(candidateId: string, draft: ComposeDraft) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(DRAFT_KEY(candidateId), JSON.stringify(draft))
  } catch {
    /* quota / disabled */
  }
}

export function clearComposeDraft(candidateId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(DRAFT_KEY(candidateId))
  } catch {
    /* noop */
  }
  current.delete(candidateId)
}

/**
 * The message currently on screen for a candidate, seeded or edited.
 *
 * Deliberately in memory only. The composer treats a SAVED draft as "the user
 * has content here" and restores every field from it, so persisting a seed
 * nobody typed would hand the composer an empty recipient list and wipe the
 * prefilled address. Only real edits reach localStorage.
 */
const current = new Map<string, string>()

/** Publishes the message for a candidate without persisting it. */
export function publishDraftMessage(candidateId: string, message: string) {
  if (current.get(candidateId) === message) return
  current.set(candidateId, message)
  listeners.get(candidateId)?.forEach(fn => fn(message))
}

/** The message on screen for a candidate: a live edit, a saved draft, else null. */
export function currentDraftMessage(candidateId: string): string | null {
  return current.get(candidateId) ?? readMessage(candidateId)
}

function readMessage(candidateId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(candidateId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed?.message === "string" ? parsed.message : null
  } catch {
    return null
  }
}

/** Writes the message into the existing draft, preserving its other fields. */
function writeMessage(candidateId: string, message: string) {
  if (typeof window === "undefined") return
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(candidateId))
    const parsed = raw ? JSON.parse(raw) : {}
    window.localStorage.setItem(
      DRAFT_KEY(candidateId),
      JSON.stringify({ to: [], cc: "", subject: "", payNow: true, ...parsed, message }),
    )
  } catch {
    /* quota / disabled — the in-memory value still drives this session */
  }
  listeners.get(candidateId)?.forEach(fn => fn(message))
}

export function useDraftMessage(candidateId: string, seed: string) {
  const [message, setMessageState] = useState<string>(() => readMessage(candidateId) ?? seed)

  // Re-seed when switching invoices, but never overwrite an edit already saved
  // for that invoice. When nothing is saved yet, PERSIST the seed so the
  // compose window shows the same text — otherwise it falls back to its own
  // older template and the two panes disagree about what the client is told.
  useEffect(() => {
    const next = readMessage(candidateId) ?? seed
    setMessageState(next)
    publishDraftMessage(candidateId, next)
  }, [candidateId, seed])

  // Stay in step with the other component editing the same candidate.
  useEffect(() => {
    const set = listeners.get(candidateId) ?? new Set<Listener>()
    listeners.set(candidateId, set)
    const fn: Listener = next => setMessageState(next)
    set.add(fn)
    return () => {
      set.delete(fn)
      if (set.size === 0) listeners.delete(candidateId)
    }
  }, [candidateId])

  const setMessage = useCallback((next: string) => {
    setMessageState(next)
    current.set(candidateId, next)
    writeMessage(candidateId, next)
  }, [candidateId])

  const resetToTemplate = useCallback(() => {
    setMessageState(seed)
    current.set(candidateId, seed)
    writeMessage(candidateId, seed)
  }, [candidateId, seed])

  const edited = message !== seed

  return { message, setMessage, resetToTemplate, edited }
}

/** Current saved message for a candidate, or null when nothing is saved yet. */
export function readDraftMessage(candidateId: string): string | null {
  return readMessage(candidateId)
}

/** Subscribe to edits made elsewhere (e.g. the preview pane). Returns an unsubscribe. */
export function subscribeDraftMessage(candidateId: string, fn: (message: string) => void): () => void {
  const set = listeners.get(candidateId) ?? new Set<Listener>()
  listeners.set(candidateId, set)
  set.add(fn)
  return () => {
    set.delete(fn)
    if (set.size === 0) listeners.delete(candidateId)
  }
}
