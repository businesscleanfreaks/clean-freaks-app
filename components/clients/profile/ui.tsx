"use client"

import { useEffect, type CSSProperties, type ReactNode } from "react"

/**
 * The client profile's building blocks, from Client Profile Main.dc.html:
 * mint-banded cards, "Add" actions as small buttons, teal text actions with a
 * hover pill, and the modal shell every editor uses.
 */

export const C = {
  mint: "#e9f6f1",
  mintBorder: "#cfe3dc",
  mintTitle: "#0b4f3f",
  teal: "#0f766e",
  primary: "#0d9488",
  hoverTint: "#ecfdf9",
  pill: "#d1f5ee",
  text: "#1a1a1a",
  sub: "#5c574e",
  muted: "#8a857a",
  faint: "#a39d90",
  hair: "#f4efe6",
  border: "#ece7dd",
  amber: "#b45309",
  amberBg: "#fdf0df",
} as const

export const PROFILE_STYLES = `
  .cfp { color: ${C.text}; }
  .cfp-add { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 800; color: ${C.teal}; background: #fff; border: 1px solid #cfe9e2; padding: 6px 11px; border-radius: 8px; cursor: pointer; white-space: nowrap; transition: background .12s ease, border-color .12s ease; font-family: inherit; }
  .cfp-add.small { padding: 4px 9px; font-size: 11.5px; }
  .cfp-add:hover { background: ${C.hoverTint}; border-color: #9fdccf; }
  .cfp-link { font-size: 11px; font-weight: 800; color: ${C.teal}; padding: 3px 7px; margin: -3px -7px; border-radius: 6px; cursor: pointer; white-space: nowrap; transition: background .12s ease; background: none; border: none; font-family: inherit; }
  .cfp-link:hover { background: ${C.pill}; text-decoration: underline; }
  .cfp-tint { transition: background .12s ease; cursor: pointer; }
  .cfp-tint:hover { background: ${C.hoverTint}; }
  .cfp-row { border-radius: 8px; cursor: pointer; }
  .cfp-row:hover { background: #faf8f3; }
  .cfp-next { background: #12403a; transition: background .12s ease; }
  .cfp-next:hover { background: #0d615b; }
  .cfp-input { width: 100%; font-size: 13.5px; padding: 10px 12px; border: 1px solid #e6dfd1; border-radius: 10px; outline: none; background: #fff; color: ${C.text}; box-sizing: border-box; font-family: inherit; }
  .cfp-input:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px rgba(13,148,136,0.12); }
  .cfp-btn { font-size: 12.5px; font-weight: 700; padding: 9px 16px; border-radius: 9px; cursor: pointer; font-family: inherit; }
  .cfp-btn.primary { color: #fff; background: ${C.primary}; border: none; }
  .cfp-btn.primary:hover { background: #0b7f74; }
  .cfp-btn.primary:disabled { background: #cfc8ba; cursor: not-allowed; }
  .cfp-btn.ghost { color: ${C.sub}; background: #fff; border: 1px solid #e6e0d4; }
  .cfp-btn.ghost:hover { background: #faf8f3; }
  .cfp-btn.danger { color: #b4413a; background: #fff; border: 1px solid #f0d5d2; }
  .cfp-btn.danger:hover { background: #fbeeec; }
  .cfp-menu-item { font-size: 13px; font-weight: 600; padding: 8px 11px; border-radius: 8px; cursor: pointer; color: ${C.text}; }
  .cfp-menu-item:hover { background: #f4f0e8; }
  .cfp-overview { display: grid; grid-template-columns: minmax(0,1fr) 320px; gap: 18px; margin-top: 20px; align-items: start; }
  .cfp-billing { display: grid; grid-template-columns: minmax(0,1fr) 320px; gap: 20px; margin-top: 22px; align-items: start; }
  @media (max-width: 1000px) {
    .cfp-overview, .cfp-billing { grid-template-columns: minmax(0,1fr); }
  }
  @media (max-width: 760px) {
    .cfp-page { padding: 14px 14px 40px !important; }
    .cfp-head-right { width: 100%; justify-content: space-between; }
    .cfp-tabs { overflow-x: auto; }
    .cfp-inv-row { grid-template-columns: minmax(0,1fr) auto !important; row-gap: 4px !important; }
    .cfp-inv-row > .cfp-inv-hide { display: none !important; }
  }
`

export function Card({
  title,
  action,
  children,
  wide = false,
  style,
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  wide?: boolean
  style?: CSSProperties
}) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.mintBorder}`, borderRadius: 14, overflow: "hidden", minWidth: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", padding: wide ? "10px 20px" : "10px 16px", background: C.mint, borderBottom: `1px solid ${C.mintBorder}` }}>
        <span style={{ fontSize: wide ? 15 : 12.5, fontWeight: 800, letterSpacing: "-0.01em", color: C.mintTitle, whiteSpace: "nowrap" }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

const Plus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
)

export function AddButton({ label, onClick, small = false, icon }: { label: string; onClick: () => void; small?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" className={`cfp-add${small ? " small" : ""}`} onClick={onClick}>
      {icon ?? <Plus />}
      {label}
    </button>
  )
}

export function LinkAction({ children, onClick, style }: { children: ReactNode; onClick: (e: React.MouseEvent) => void; style?: CSSProperties }) {
  return (
    <button type="button" className="cfp-link" onClick={e => { e.stopPropagation(); onClick(e) }} style={style}>
      {children}
    </button>
  )
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, ...style }}>{children}</span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 440,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div
      onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(30,24,12,0.30)", zIndex: 62, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 12px 12px" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={e => e.stopPropagation()}
        style={{ width, maxWidth: "94vw", maxHeight: "84vh", display: "flex", flexDirection: "column", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 24px 60px rgba(40,30,10,0.22)", color: C.text }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px 0" }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em" }}>{title}</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f4f0e8", color: C.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div style={{ padding: "14px 22px 16px", overflowY: "auto", flex: 1, minHeight: 0 }}>{children}</div>
        {footer && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 22px 16px", borderTop: `1px solid #f0ebe1` }}>{footer}</div>
        )}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  )
}

export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "").split(/[\s(]+/).filter(Boolean)
  return words.slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?"
}
