/**
 * Per-person avatar colours.
 *
 * The design gives every cleaner and vendor their own pastel, which is what
 * makes a long table scannable — you find Maggie by her orange before you read
 * the name. Ours come from the database rather than a fixed list, so the colour
 * is derived from the name: stable for a given person, spread across the
 * palette, and never needing a migration.
 */

export interface AvatarColor {
  bg: string
  fg: string
}

/** Taken from the handoff's own roster so the feel matches. */
export const AVATAR_PALETTE: AvatarColor[] = [
  { bg: "#fdeee2", fg: "#d06414" },
  { bg: "#e2f4f0", fg: "#118a76" },
  { bg: "#f1ebfe", fg: "#7c5cd6" },
  { bg: "#eceefc", fg: "#5561cf" },
  { bg: "#fdeef5", fg: "#c2418f" },
  { bg: "#fbf3d9", fg: "#a16207" },
  { bg: "#e0f2fe", fg: "#0369a1" },
  { bg: "#eef4ff", fg: "#2a6fdb" },
]

/**
 * A small stable hash. Not cryptographic — it only has to spread names across
 * the palette and give the same answer every render.
 */
export function avatarColor(name: string): AvatarColor {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]
}

/** Up to two initials, e.g. "Celeste Cleaning Co." → "CC". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join("")
    .toUpperCase()
}
