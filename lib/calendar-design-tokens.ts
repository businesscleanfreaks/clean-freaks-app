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

// Vivid, saturated solid-ish gradients for job cards (per Josh's calendar dev notes:
// "fully opaque, saturated background color (no transparency, no pastels)").
// Each gradient is a very narrow band between the target hex and a slightly darker shade,
// so visually it reads as a solid bold color.
export const JOB_GRADIENTS = {
  teal: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
  purple: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',     // Ana Lina
  amber: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',      // Amy's Angels / yellow team
  orange: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)',     // Maggie
  rose: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
  red: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',         // Rosa
  blue: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',       // Ricardo (MCS)
  emerald: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',    // Celeste Cleaning Co.
  indigo: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',     // Recurring / Willowcrest
  slate: 'linear-gradient(135deg, #64748B 0%, #475569 100%)',      // Unassigned / fallback
  default: 'linear-gradient(135deg, #64748B 0%, #475569 100%)',    // Same as slate
} as const

// Map cleaner names → color keys (case-insensitive, partial-match aware)
export const CLEANER_COLORS: Record<string, keyof typeof JOB_GRADIENTS> = {
  'maggie': 'orange',
  'celeste': 'emerald',
  'ana lina': 'purple',
  'ana': 'purple',
  'ricardo': 'blue',
  'mcs': 'blue',
  'amy': 'amber',
  'rosa': 'red',
  'marcia': 'rose',
}

// Hex colors for filter pills, color dots, and any place we need a solid color
export const CLEANER_HEX_COLORS: Record<keyof typeof JOB_GRADIENTS, string> = {
  teal: '#14b8a6',
  purple: '#8B5CF6',
  amber: '#F59E0B',
  orange: '#F97316',
  rose: '#f43f5e',
  red: '#EF4444',
  blue: '#2563EB',
  emerald: '#10B981',
  indigo: '#6366F1',
  slate: '#64748B',
  default: '#64748B',
}

// Deeper companions for the 5px performer spine used by solid calendar cards.
// Keeping this separate from the filter-dot color preserves the mockup's
// dark leading edge without making picker swatches look muddy.
export const JOB_SPINE_COLORS: Record<keyof typeof JOB_GRADIENTS, string> = {
  teal: '#0F766E',
  purple: '#5B3FB0',
  amber: '#9A6700',
  orange: '#C2410C',
  rose: '#BE185D',
  red: '#B91C1C',
  blue: '#1E40AF',
  emerald: '#047857',
  indigo: '#4338CA',
  slate: '#334155',
  default: '#334155',
}

// Get color for a cleaner name (returns color key and hex)
export function getCleanerColorInfo(cleanerName: string | null): { colorKey: keyof typeof JOB_GRADIENTS; hex: string } {
  if (!cleanerName) {
    return { colorKey: 'slate', hex: CLEANER_HEX_COLORS.slate }
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

  // Fallback: hash-based color from the vivid palette
  const fallbackColors: (keyof typeof JOB_GRADIENTS)[] = ['teal', 'indigo', 'amber', 'rose']
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
