"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { filterByPrefix, shouldShowOptions } from "@/lib/combobox"

/**
 * A text field with suggestions.
 *
 * Not a select: whatever is typed stands on its own, and the options are a
 * shortcut rather than a constraint. The list opens on click, filters by prefix
 * as you type, and closes when nothing matches — at which point the typed text
 * is simply the value.
 */
export function Combobox({ value, onChange, options, placeholder, hintFor, id }: {
  value: string
  onChange: (next: string) => void
  options: string[]
  placeholder?: string
  /** Optional trailing note on an option, e.g. which number Zelle would use. */
  hintFor?: (option: string) => string | null
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const shown = filterByPrefix(options, value)
  const listOpen = open && shouldShowOptions(options, value)

  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <input
        id={id}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onClick={() => setOpen(v => !v)}
        placeholder={placeholder}
        className="w-full rounded-[8px] border border-[#e2e2df] bg-white py-[9px] pl-3 pr-[30px] text-[13px] font-semibold text-[#0d0d0e] outline-none focus:border-[#0b7a4e]"
      />
      <ChevronDown
        size={13}
        strokeWidth={2.4}
        className="pointer-events-none absolute right-[11px] top-1/2 -translate-y-1/2 text-[#9a9fa4]"
      />

      {listOpen && (
        <>
          <div className="fixed inset-0 z-[86]" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-[87] max-h-[190px] overflow-auto rounded-[8px] border border-[#e2e2df] bg-white p-[5px]"
            style={{ boxShadow: "0 4px 10px rgba(16,24,40,.06), 0 16px 32px rgba(16,24,40,.12)" }}
          >
            {shown.map(o => {
              const hint = hintFor?.(o)
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => { onChange(o); setOpen(false) }}
                  className="flex w-full items-baseline gap-[7px] rounded-[6px] px-[9px] py-[7px] text-left text-[12.5px] font-semibold text-[#3f4347] hover:bg-[#f6f6f3]"
                >
                  {o}
                  {hint && <span className="text-[11px] font-semibold text-[#b6bbc0]">{hint}</span>}
                </button>
              )
            })}
            <div className="mt-[3px] border-t border-[#f0f0ed] px-[9px] pb-1 pt-1.5 text-[11px] font-semibold text-[#b6bbc0]">
              or just type your own
            </div>
          </div>
        </>
      )}
    </div>
  )
}
