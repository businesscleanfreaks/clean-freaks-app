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

// Flat matte fills for job cards, matching the Calendar Main mockup exactly.
// The mockup computes these as oklch(lb, chroma*0.85*1.22, hue) per performer
// (hues 30/75/155/200/235/255/295/345, lb ≈ 0.64 + a boost near hue 95);
// the hex values below are the exact sRGB conversions of those formulas.
// NOTE: kept under the JOB_GRADIENTS name for API compatibility — the values
// are now solid colors (the mockup has NO gradients on cards).
export const JOB_GRADIENTS = {
  teal: '#00a2a9',      // hue 200
  purple: '#937ad5',    // hue 295 — Ana Lina
  amber: '#e47261',     // hue 30 — Amy's Angels
  orange: '#ecad4b',    // hue 75 — Juan (gold)
  rose: '#c569a0',      // hue 345 — Maggie
  red: '#c569a0',       // hue 345
  blue: '#0598d2',      // hue 235 — vendors
  emerald: '#53b279',   // hue 155 — Celeste Cleaning Co.
  indigo: '#4f8edc',    // hue 255 — Marcia
  slate: '#82878c',     // unassigned (near-gray)
  default: '#82878c',
} as const

// Map cleaner names → color keys (case-insensitive, partial-match aware).
// Hue assignments follow the mockup's roster.
export const CLEANER_COLORS: Record<string, keyof typeof JOB_GRADIENTS> = {
  'maggie': 'rose',
  'celeste': 'emerald',
  'ana lina': 'purple',
  'ana': 'purple',
  'juan': 'orange',
  'ricardo': 'blue',
  'mcs': 'blue',
  'amy': 'amber',
  'rosa': 'red',
  'marcia': 'indigo',
}

// Solid dot/avatar colors (mockup: oklch(0.60, ch, hue)) for filter pills,
// color dots, and `${hex}33`-style alpha tints.
export const CLEANER_HEX_COLORS: Record<keyof typeof JOB_GRADIENTS, string> = {
  teal: '#239196',
  purple: '#8572bb',
  amber: '#bd6254',
  orange: '#a67527',
  rose: '#ae648f',
  red: '#ae648f',
  blue: '#2c8ab8',
  emerald: '#489265',
  indigo: '#5182c1',
  slate: '#6e7278',
  default: '#6e7278',
}

// Same-hue darker leading edge for the card spine (mockup: oklch(0.47, ch, hue)).
export const JOB_SPINE_COLORS: Record<keyof typeof JOB_GRADIENTS, string> = {
  teal: '#006a6f',
  purple: '#604c92',
  amber: '#923c30',
  orange: '#7e5000',
  rose: '#853e69',
  red: '#853e69',
  blue: '#00638f',
  emerald: '#1d6b41',
  indigo: '#2b5c97',
  slate: '#5f6469',
  default: '#5f6469',
}

// Hue-tinted dark ink (mockup: oklch(0.42, ch*0.78, hue)) — for text that sits
// on the pale tints of the same hue (rails, chips).
export const JOB_INK_COLORS: Record<keyof typeof JOB_GRADIENTS, string> = {
  teal: '#00595d',
  purple: '#514277',
  amber: '#78372d',
  orange: '#684505',
  rose: '#6e3858',
  red: '#6e3858',
  blue: '#075475',
  emerald: '#235a39',
  indigo: '#2a4e7b',
  slate: '#4a4d51',
  default: '#4a4d51',
}

// The mockup's card surface treatment: no outer border — an inset white top
// highlight plus a soft drop shadow.
export const JOB_CARD_SHADOW = 'inset 0 1px 0 rgba(255,255,255,0.65), 0 1px 2px rgba(16,24,40,0.12)'

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
