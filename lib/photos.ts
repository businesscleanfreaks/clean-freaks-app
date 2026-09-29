/**
 * Photos of clients, locations and contacts: who can own one, what may be
 * uploaded, and the URL a page shows it by.
 *
 * Stored in their own table (the Photo model) and served by
 * app/api/photos/[owner]/[id]. Pages never receive the bytes in their data,
 * only a URL carrying the photo's `updatedAt`, so a replaced photo is a new
 * URL and the old one can be cached for good.
 *
 * Pure: no Prisma, no browser.
 */

export const PHOTO_OWNERS = ["client", "location", "contact"] as const
export type PhotoOwner = (typeof PHOTO_OWNERS)[number]

export const isPhotoOwner = (value: string): value is PhotoOwner =>
  (PHOTO_OWNERS as readonly string[]).includes(value)

/**
 * Kept small on purpose: photos live inline in Postgres, not on a file host.
 * The browser shrinks a picture before sending it (lib/photo-shrink.ts), so
 * this only bites when that could not run.
 */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const

/** Why this file cannot be a photo, or null when it can. */
export function photoUploadProblem(file: { size: number; type: string }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return "Upload a JPG, PNG or WebP image."
  if (file.size === 0) return "That file is empty."
  if (file.size > PHOTO_MAX_BYTES) return "That photo is over 5MB."
  return null
}

/**
 * Where a page loads the photo from, or null when there is none. The version
 * is the photo's `updatedAt`.
 */
export function photoUrl(
  owner: PhotoOwner,
  ownerId: string,
  version: Date | string | null | undefined,
): string | null {
  if (!version) return null
  const at = typeof version === "string" ? new Date(version).getTime() : version.getTime()
  return `/api/photos/${owner}/${ownerId}?v=${Number.isFinite(at) ? at : 0}`
}

/**
 * The size to draw a picture at so its longer side is at most `max`. Never
 * enlarges: a small picture keeps its size.
 */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longer = Math.max(width, height)
  if (longer <= max || longer <= 0) return { width, height }
  const scale = max / longer
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
