/** Haptic feedback stub — provides vibration on supported mobile devices */

type HapticStyle = 'light' | 'medium' | 'heavy' | 'selection'

export function haptic(style: HapticStyle = 'light'): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return

  const durations: Record<HapticStyle, number> = {
    light: 10,
    medium: 20,
    heavy: 30,
    selection: 5,
  }

  try {
    navigator.vibrate(durations[style] ?? 10)
  } catch {
    // Silently fail — haptics are non-critical
  }
}
