"use client"

import { useState, useEffect } from "react"

const TOOLTIP_SETTING_KEY = 'tooltips-enabled'
const DEFAULT_ENABLED = true // Tooltips enabled by default

/**
 * Hook to manage tooltip preference
 * Stores preference in localStorage
 */
export function useTooltipSetting() {
  const [enabled, setEnabled] = useState<boolean>(DEFAULT_ENABLED)
  const [mounted, setMounted] = useState(false)

  // Load preference from localStorage on mount
  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem(TOOLTIP_SETTING_KEY)
    if (saved !== null) {
      setEnabled(saved === 'true')
    } else {
      // First time - set default
      localStorage.setItem(TOOLTIP_SETTING_KEY, String(DEFAULT_ENABLED))
    }
  }, [])

  const toggle = () => {
    const newValue = !enabled
    setEnabled(newValue)
    localStorage.setItem(TOOLTIP_SETTING_KEY, String(newValue))
  }

  const enable = () => {
    setEnabled(true)
    localStorage.setItem(TOOLTIP_SETTING_KEY, 'true')
  }

  const disable = () => {
    setEnabled(false)
    localStorage.setItem(TOOLTIP_SETTING_KEY, 'false')
  }

  return {
    enabled: mounted ? enabled : DEFAULT_ENABLED, // Return default until mounted to avoid hydration mismatch
    toggle,
    enable,
    disable,
    mounted,
  }
}

