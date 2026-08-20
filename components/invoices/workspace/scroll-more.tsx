"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * A scroll region that says so when there is more underneath.
 *
 * The review pane is long and the pinned footer sits right below the fold, so
 * it reads as the end of the page. The pill only shows while something is
 * actually cut off, and clicking it moves down a screenful.
 */
export function ScrollWithMoreBelow({ className, style, resetKey, children }: {
  className?: string
  style?: React.CSSProperties
  /** Scrolls back to the top whenever this changes (e.g. a new invoice). */
  resetKey?: string | number | null
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 24)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = 0
    measure()
  }, [resetKey, measure])

  // Content arrives late (adjustments, calendar), so watch the box as well as
  // the scroll position — a one-shot measure would miss it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => {
      el.removeEventListener("scroll", measure)
      ro.disconnect()
    }
  }, [measure, children])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
      {more && (
        <button
          type="button"
          onClick={() => {
            const el = ref.current
            if (el) el.scrollBy({ top: el.clientHeight * 0.8, behavior: "smooth" })
          }}
          className="absolute bottom-[7px] left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-[5px] text-[11px] font-bold"
          style={{
            color: "#5b6470",
            background: "#fff",
            border: "1px solid #e2e5e9",
            boxShadow: "0 2px 8px rgba(16,24,40,.12)",
          }}
        >
          More below
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  )
}
