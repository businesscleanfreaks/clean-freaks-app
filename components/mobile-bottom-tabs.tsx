"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Home, Calendar, Users, FileText, UserCheck, MoreHorizontal, X } from "lucide-react"
import { useState } from "react"
import { haptic } from "@/lib/haptics"

interface TabItem {
  href: string
  label: string
  icon: React.ReactNode
  matchPaths: string[]
}

const primaryTabs: TabItem[] = [
  {
    href: "/",
    label: "Home",
    icon: <Home className="w-5 h-5" />,
    matchPaths: ["/"]
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: <Calendar className="w-5 h-5" />,
    matchPaths: ["/calendar"]
  },
  {
    href: "/clients",
    label: "Clients",
    icon: <Users className="w-5 h-5" />,
    matchPaths: ["/clients"]
  },
  {
    href: "/invoices",
    label: "Invoices",
    icon: <FileText className="w-5 h-5" />,
    matchPaths: ["/invoices"]
  },
]

const moreMenuItems = [
  { href: "/subcontractors", label: "Cleaners", icon: <UserCheck className="w-5 h-5" /> },
]

export function MobileBottomTabs() {
  const pathname = usePathname()
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)

  const isMoreActive = moreMenuItems.some(item =>
    pathname.startsWith(item.href)
  )

  const isActive = (tab: TabItem) => {
    if (tab.href === "/") {
      return pathname === "/"
    }
    return tab.matchPaths.some(path => pathname.startsWith(path))
  }

  return (
    <>
      {/* More Menu Overlay */}
      {moreMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
          onClick={() => setMoreMenuOpen(false)}
        />
      )}
      
      {/* More Menu Panel */}
      {moreMenuOpen && (
        <div 
          className="fixed bottom-[72px] left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-[65] animate-slide-up"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="p-4 pb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">More Options</h3>
              <button
                onClick={() => setMoreMenuOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {moreMenuItems.map((item) => {
                const active = pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreMenuOpen(false)}
                    className={`flex items-center gap-3 p-4 rounded-xl transition-all active:scale-95 min-h-[60px] ${
                      active 
                        ? 'bg-teal-50 text-teal-700 border-2 border-teal-200' 
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-2 border-transparent'
                    }`}
                  >
                    <div className={`${active ? 'text-teal-600' : 'text-gray-500'}`}>
                      {item.icon}
                    </div>
                    <span className="font-medium">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Tab Bar */}
      <nav 
        className="mobile-bottom-tabs"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-around h-full max-w-md mx-auto">
          {primaryTabs.map((tab) => {
            const active = isActive(tab)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex flex-col items-center justify-center gap-1 min-w-[64px] h-full px-3 transition-all active:scale-95 ${
                  active ? 'text-teal-600' : 'text-gray-500'
                }`}
              >
                <div className={`relative ${active ? 'transform scale-110' : ''}`}>
                  {tab.icon}
                  {active && (
                    <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-teal-600 rounded-full" />
                  )}
                </div>
                <span className={`text-[11px] font-medium ${active ? 'text-teal-600' : 'text-gray-500'}`}>
                  {tab.label}
                </span>
              </Link>
            )
          })}
          
          {/* More Button */}
          <button
            onClick={() => { haptic('light'); setMoreMenuOpen(true) }}
            className={`flex flex-col items-center justify-center gap-1 min-w-[64px] h-full px-3 transition-all active:scale-95 ${
              isMoreActive || moreMenuOpen ? 'text-teal-600' : 'text-gray-500'
            }`}
          >
            <div className={`relative ${isMoreActive || moreMenuOpen ? 'transform scale-110' : ''}`}>
              <MoreHorizontal className="w-5 h-5" />
              {(isMoreActive || moreMenuOpen) && (
                <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-teal-600 rounded-full" />
              )}
            </div>
            <span className={`text-[11px] font-medium ${isMoreActive || moreMenuOpen ? 'text-teal-600' : 'text-gray-500'}`}>
              More
            </span>
          </button>
        </div>
      </nav>

      <style jsx global>{`
        .mobile-bottom-tabs {
          display: none;
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 72px;
          background: white;
          border-top: 1px solid #e5e7eb;
          z-index: 50;
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);
        }
        
        @media (max-width: 1023px) {
          .mobile-bottom-tabs {
            display: block;
          }
        }
        
        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(100%);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-slide-up {
          animation: slide-up 0.25s ease-out forwards;
        }
      `}</style>
    </>
  )
}
