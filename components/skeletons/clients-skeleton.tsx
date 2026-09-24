"use client"

import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

/**
 * The Clients page while it loads, in the page's own shape (see
 * components/clients/clients-page-wrapper.tsx) so the list lands where the
 * placeholders were instead of replacing a different layout.
 */
export function ClientsSkeleton() {
  return (
    <div className="cfsk-page">
      <style>{`
        .cfsk-page { width: 100%; max-width: 1760px; margin: 0 auto; padding: 22px 30px 40px; }
        .cfsk-row { display: grid; grid-template-columns: minmax(200px,1fr) 158px 152px 116px; gap: 14px; align-items: center; padding: 12px 18px; border-top: 1px solid #f4efe6; }
        .cfsk-row:first-child { border-top: none; }
        .cfsk-wide { display: block; }
        @media (max-width: 760px) {
          .cfsk-page { padding: 16px 14px 32px; }
          .cfsk-row { grid-template-columns: minmax(0,1fr) auto; padding: 12px 14px; }
          .cfsk-wide { display: none; }
        }
      `}</style>

      {/* Top bar: title, search, Add Client */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <SkeletonPulse className="h-7 w-28" />
        <SkeletonPulse className="h-10 flex-1" style={{ maxWidth: 440, minWidth: 220 }} />
        <SkeletonPulse className="h-10 w-32" style={{ marginLeft: "auto" }} />
      </div>

      {/* Tabs and view toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 18, paddingBottom: 9, borderBottom: "1px solid #e9e3d7", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 22 }}>
          {[44, 84, 84, 52, 68].map((w, i) => (
            <SkeletonPulse key={i} className="h-4" style={{ width: w }} />
          ))}
        </div>
        <SkeletonPulse className="h-8 w-64" />
      </div>

      {/* Rows */}
      <div style={{ marginTop: 40, background: "#fff", border: "1px solid #ece7dd", borderRadius: 14, overflow: "hidden" }}>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="cfsk-row">
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <SkeletonPulse className="h-8 w-8" style={{ borderRadius: 9, flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <SkeletonPulse className="h-3.5" style={{ width: `${55 + ((i * 17) % 30)}%` }} />
                <SkeletonPulse className="h-3 mt-1.5" style={{ width: "35%" }} />
              </div>
            </div>
            <SkeletonPulse className="h-3.5 w-28 cfsk-wide" />
            <SkeletonPulse className="h-3.5 w-32 cfsk-wide" />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
              <SkeletonPulse className="h-3.5 w-14" />
              <SkeletonPulse className="h-2.5 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
