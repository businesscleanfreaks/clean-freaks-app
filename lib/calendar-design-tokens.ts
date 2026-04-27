/**
 * Design tokens for premium calendar animations and styling
 */

// Animation durations (in milliseconds)
export const ANIMATION_DURATION = {
  fast: 150,
  normal: 300,
  slow: 500,
  verySlow: 800,
} as const

// Easing curves (for CSS transitions and animations)
export const EASING = {
  // Smooth, natural feeling
  easeOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  // Spring-like bounce
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  // Sharp, quick
  sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
  // Smooth entrance
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
} as const

// Spring physics configuration for animations
export const SPRING_CONFIG = {
  gentle: {
    type: 'spring' as const,
    stiffness: 200,
    damping: 25,
    mass: 0.8,
  },
  normal: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 30,
    mass: 0.8,
  },
  bouncy: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 20,
    mass: 0.8,
  },
} as const

// Shadow elevations (for depth and layering)
export const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
} as const

// Color gradients for job cards
export const JOB_GRADIENTS = {
  teal: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
  purple: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
  amber: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  orange: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', // Maggie
  rose: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
  red: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', // Unassigned
  blue: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', // Celeste
  emerald: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', // Ana Lina
  default: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
} as const

// Map cleaner names to colors (case-insensitive)
export const CLEANER_COLORS: Record<string, keyof typeof JOB_GRADIENTS> = {
  'maggie': 'orange',
  'celeste': 'blue',
  'ana lina': 'emerald',
}

// Hex colors for filter pills and legend (primary color from each gradient)
export const CLEANER_HEX_COLORS: Record<keyof typeof JOB_GRADIENTS, string> = {
  teal: '#14b8a6',
  purple: '#a855f7',
  amber: '#f59e0b',
  orange: '#f97316',
  rose: '#f43f5e',
  red: '#ef4444',
  blue: '#3b82f6',
  emerald: '#10b981',
  default: '#6b7280',
}

// Get color for a cleaner name (returns color key and hex)
export function getCleanerColorInfo(cleanerName: string | null): { colorKey: keyof typeof JOB_GRADIENTS; hex: string } {
  if (!cleanerName) {
    return { colorKey: 'red', hex: CLEANER_HEX_COLORS.red }
  }
  
  const normalizedName = cleanerName.toLowerCase().trim()
  
  // Check exact match
  if (CLEANER_COLORS[normalizedName]) {
    const colorKey = CLEANER_COLORS[normalizedName]
    return { colorKey, hex: CLEANER_HEX_COLORS[colorKey] }
  }
  
  // Check partial match
  for (const [name, colorKey] of Object.entries(CLEANER_COLORS)) {
    if (normalizedName.includes(name) || name.includes(normalizedName)) {
      return { colorKey, hex: CLEANER_HEX_COLORS[colorKey] }
    }
  }
  
  // Fallback: hash-based color
  const fallbackColors: (keyof typeof JOB_GRADIENTS)[] = ['teal', 'purple', 'amber', 'rose']
  const hash = normalizedName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const colorKey = fallbackColors[hash % fallbackColors.length]
  return { colorKey, hex: CLEANER_HEX_COLORS[colorKey] }
}

// Spacing system (for consistent whitespace)
export const SPACING = {
  xs: '0.25rem', // 4px
  sm: '0.5rem',  // 8px
  md: '1rem',    // 16px
  lg: '1.5rem',  // 24px
  xl: '2rem',    // 32px
  '2xl': '3rem', // 48px
} as const

// Border radius
export const RADIUS = {
  sm: '0.375rem',  // 6px
  md: '0.5rem',    // 8px
  lg: '0.75rem',   // 12px
  xl: '1rem',      // 16px
  full: '9999px',
} as const

// Z-index layers
export const Z_INDEX = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
  dragOverlay: 9999,
} as const

// Transition presets
export const TRANSITIONS = {
  fast: `${ANIMATION_DURATION.fast}ms ${EASING.easeOut}`,
  normal: `${ANIMATION_DURATION.normal}ms ${EASING.easeOut}`,
  slow: `${ANIMATION_DURATION.slow}ms ${EASING.easeOut}`,
  spring: `${ANIMATION_DURATION.normal}ms ${EASING.spring}`,
} as const

