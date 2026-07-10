"use client"

import {
  Calendar,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { showError, showSuccess } from "@/lib/toast"

interface NavItem {
  name: string
  href: string
  icon: LucideIcon
}

const items: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Calendar", href: "/calendar", icon: Calendar },
  { name: "Clients", href: "/clients", icon: Users },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Payables", href: "/payables", icon: Wallet },
  { name: "Settings", href: "/settings", icon: Settings },
]

interface NavSidebarProps {
  onNavigate?: () => void
  variant?: "desktop" | "mobile"
}

export function NavSidebar({ onNavigate, variant = "desktop" }: NavSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)
  const mobile = variant === "mobile"

  useEffect(() => {
    fetch("/api/auth/session")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setEmail(data?.user?.email || null))
      .catch(() => null)
  }, [])

  useEffect(() => {
    if (!accountOpen) return
    const close = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [accountOpen])

  const logout = async () => {
    if (!window.confirm("Sign out of Clean Freaks? You will need to sign in again to access the workspace.")) return
    setLoggingOut(true)
    setAccountOpen(false)
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      if (!response.ok) throw new Error("Failed to sign out")
      showSuccess("Logged out successfully")
      router.push("/login")
      router.refresh()
    } catch {
      showError("Failed to sign out")
      setLoggingOut(false)
    }
  }

  const initial = email?.split("@")[0]?.charAt(0).toUpperCase() || "J"

  return (
    <div className={`nav-sidebar relative flex h-full min-h-0 flex-col border-r border-[#e8e4dc] bg-white text-stone-700 ${mobile ? "w-[280px]" : "w-[78px]"}`}>
      <div className={`flex h-[70px] flex-none items-center border-b border-[#f1ede6] ${mobile ? "gap-3 px-5" : "justify-center"}`}>
        <Sparkles size={mobile ? 20 : 17} strokeWidth={1.8} className="text-[#087c57]" />
        {mobile && <span className="text-[17px] font-extrabold text-stone-900">Clean Freaks</span>}
      </div>

      <nav className={`flex-1 overflow-y-auto ${mobile ? "space-y-1 px-3 py-5" : "space-y-1 px-2 py-5"}`}>
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={!mobile ? item.name : undefined}
              className={`flex rounded-lg transition-colors ${mobile ? "h-11 items-center gap-3 px-3" : "h-[58px] flex-col items-center justify-center gap-1"} ${active ? "bg-[#e9f4ef] text-[#087c57]" : "text-[#718096] hover:bg-[#faf8f3] hover:text-stone-900"}`}
            >
              <item.icon size={mobile ? 18 : 19} strokeWidth={1.7} />
              <span className={`${mobile ? "text-[13px]" : "text-[9px]"} font-bold leading-none`}>{item.name}</span>
            </Link>
          )
        })}
      </nav>

      <div ref={accountRef} className={`relative flex-none border-t border-[#f1ede6] ${mobile ? "p-3" : "p-2"}`}>
        {mobile && email && <div className="mb-2 truncate px-3 text-[11px] text-stone-400">{email}</div>}
        {!mobile && accountOpen && (
          <div role="menu" className="absolute bottom-2 left-[68px] z-[70] w-[230px] rounded-lg border border-[#e2dccf] bg-white p-2 shadow-[0_14px_40px_rgba(28,25,23,0.18)]">
            <div className="px-2.5 py-2">
              <div className="text-[11px] font-extrabold uppercase text-stone-400">Account</div>
              <div className="mt-1 truncate text-[12px] font-semibold text-stone-700">{email || "Signed in"}</div>
            </div>
            <div className="my-1 border-t border-stone-100" />
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={loggingOut}
              className="flex h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <LogOut size={15} /> {loggingOut ? "Signing out..." : "Sign out"}
            </button>
            <p className="px-2.5 pb-1 pt-1 text-[10px] leading-snug text-stone-400">You will be asked to confirm before signing out.</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => mobile ? logout() : setAccountOpen((open) => !open)}
          disabled={loggingOut}
          title={mobile ? "Sign out" : "Account menu"}
          aria-haspopup={mobile ? undefined : "menu"}
          aria-expanded={mobile ? undefined : accountOpen}
          className={`flex w-full items-center rounded-lg text-stone-500 disabled:opacity-50 ${mobile ? "h-11 gap-3 px-3 hover:bg-red-50 hover:text-red-700" : `h-[54px] flex-col justify-center gap-1 hover:bg-[#f5faf7] hover:text-[#087c57] ${accountOpen ? "bg-[#e9f4ef] text-[#087c57]" : ""}`}`}
        >
          {mobile ? <LogOut size={18} /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e9f4ef] text-[12px] font-extrabold text-[#087c57]">{initial}</span>}
          <span className={`${mobile ? "text-[13px]" : "text-[9px]"} font-bold`}>{loggingOut ? "Signing out..." : mobile ? "Sign out" : "Account"}</span>
        </button>
      </div>
    </div>
  )
}
