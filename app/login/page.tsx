"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { showError, showSuccess } from "@/lib/toast"
import { Loader2, Mail, Lock, Eye, EyeOff } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    // Check if already logged in - with better error handling
    fetch('/api/auth/session')
      .then(async (res) => {
        if (!res.ok) {
          return { authenticated: false }
        }
        try {
          return await res.json()
        } catch (e) {
          // If JSON parsing fails, user is not authenticated
          return { authenticated: false }
        }
      })
      .then(data => {
        if (data && data.authenticated) {
          const redirect = searchParams?.get('redirect') || '/'
          router.push(redirect)
        }
      })
      .catch((error) => {
        // Not authenticated or error, stay on login page
        // Silently fail - don't show error for session check
      })
  }, [router, searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })

      let data
      try {
        data = await response.json()
      } catch (e) {
        showError('Server error. Please try again.')
        return
      }

      if (!response.ok) {
        showError(data.error || 'Invalid email or password')
        return
      }

      showSuccess('Logged in successfully')
      const redirect = searchParams?.get('redirect') || '/'
      router.push(redirect)
      router.refresh()
    } catch (error) {
      showError('Failed to login. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen min-h-[100dvh] relative flex items-center justify-center p-4 py-6 sm:py-4 overflow-hidden">
      {/* Animated Multi-Layer Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950"></div>
      
      {/* Animated Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-teal-900/20 via-transparent to-teal-800/10 animate-pulse"></div>
      
      {/* Subtle Grid Pattern */}
      <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:32px_32px]"></div>
      
      {/* Ambient Glow Effects - Hidden on small screens for performance */}
      <div className="hidden sm:block absolute top-0 left-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="hidden sm:block absolute bottom-0 right-1/4 w-96 h-96 bg-teal-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
      
      {/* Main Content */}
      <div className="w-full max-w-md relative z-10">
        {/* Logo/Brand - Compact on mobile */}
        <div className="text-center mb-6 sm:mb-12 animate-slide-in-top">
          <div className="mb-3 sm:mb-6">
            <img
              src="/images/logo.png"
              alt="The Clean Freaks Logo"
              className="mx-auto object-contain w-[80px] h-[80px] sm:w-[120px] sm:h-[120px]"
              onError={(e) => {
                // Fallback if logo doesn't exist
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
          
          <h1 className="text-3xl sm:text-5xl font-bold mb-2 sm:mb-4 tracking-tight leading-tight drop-shadow-[0_0_40px_rgba(255,255,255,0.5)]" style={{ color: '#ffffff', textShadow: '0 0 60px rgba(255,255,255,0.4), 0 0 120px rgba(45,212,191,0.3)' }}>
            The Clean Freaks
          </h1>
          <p className="text-xs sm:text-sm font-bold tracking-[0.25em] uppercase" style={{ color: '#2dd4bf', textShadow: '0 0 20px rgba(45,212,191,0.6)' }}>Management Suite</p>
        </div>

        {/* Premium Login Card with Advanced Glassmorphism */}
        <div className="relative animate-slide-in-bottom" style={{ animationDelay: '200ms' }}>
          {/* Card Glow Effect */}
          <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500/20 via-teal-400/10 to-teal-600/20 rounded-3xl blur-xl opacity-50"></div>
          
          {/* Main Card - Compact padding on mobile */}
          <div className="relative bg-slate-800/30 backdrop-blur-xl rounded-3xl border border-slate-700/40 shadow-2xl shadow-black/50 p-6 sm:p-10">
            {/* Subtle Inner Glow */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none"></div>
            
            {/* Content */}
            <div className="relative z-10">
              <h2 className="text-2xl sm:text-3xl font-bold mb-5 sm:mb-8 tracking-tight" style={{ color: '#ffffff' }}>Sign In</h2>

              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
                {/* Email Field */}
                <div className="space-y-2.5">
                  <label htmlFor="email" className="block text-slate-300 font-medium text-sm">
                    Email
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail 
                      className="w-5 h-5 pointer-events-none"
                      style={{ 
                        position: 'absolute', 
                        left: '16px', 
                        top: '50%', 
                        transform: 'translateY(-50%)',
                        color: '#94a3b8',
                        zIndex: 10
                      }} 
                    />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      required
                      disabled={isLoading}
                      autoComplete="email"
                      className="w-full h-12 bg-slate-800 border border-slate-600 rounded-xl text-white text-base placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 transition-all disabled:opacity-50"
                      style={{ paddingLeft: '48px', paddingRight: '16px' }}
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-2.5">
                  <label htmlFor="password" className="block text-slate-300 font-medium text-sm">
                    Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock 
                      className="w-5 h-5 pointer-events-none"
                      style={{ 
                        position: 'absolute', 
                        left: '16px', 
                        top: '50%', 
                        transform: 'translateY(-50%)',
                        color: '#94a3b8',
                        zIndex: 10
                      }} 
                    />
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      required
                      disabled={isLoading}
                      autoComplete="current-password"
                      className="w-full h-12 bg-slate-800 border border-slate-600 rounded-xl text-white text-base placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 transition-all disabled:opacity-50"
                      style={{ paddingLeft: '48px', paddingRight: '48px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      style={{ 
                        position: 'absolute', 
                        right: '16px', 
                        top: '50%', 
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        padding: '4px',
                        cursor: 'pointer',
                        color: '#94a3b8',
                        zIndex: 10
                      }}
                    >
                      {showPassword ? (
                        <EyeOff className="w-5 h-5" style={{ color: 'inherit' }} />
                      ) : (
                        <Eye className="w-5 h-5" style={{ color: 'inherit' }} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Premium Button */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-gradient-to-r from-teal-500 via-teal-600 to-teal-500 hover:from-teal-600 hover:via-teal-700 hover:to-teal-600 text-white font-semibold py-5 sm:py-7 text-base shadow-2xl shadow-teal-500/30 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 mt-4 sm:mt-8 relative overflow-hidden group"
                >
                  {/* Button Shine Effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                  
                  <span className="relative z-10 flex items-center justify-center">
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </span>
                </Button>
              </form>
            </div>
          </div>
        </div>

        {/* Enhanced Footer - Hidden on very small screens */}
        <div className="hidden sm:block text-center mt-6 sm:mt-10 animate-fade-in" style={{ animationDelay: '400ms' }}>
          <div className="inline-flex items-center gap-2 text-slate-500/80 text-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50"></div>
            <span className="font-medium">Secure access to your business management system</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Force deploy Wed Jan  7 20:34:28 PST 2026