/**
 * A cleaner's profile photo and W-9: what may be uploaded as each, and the
 * URL a page shows one by.
 *
 * Stored in their own table (the SubcontractorFile model) and served by
 * app/api/cleaners/[id]/files. Pages never receive the bytes in their data,
 * only a URL carrying the file's `updatedAt`, so a replaced photo is a new URL
 * and the old one can be cached for good.
 *
 * Pure: no Prisma, no browser.
 */
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from './photos'

export const CLEANER_FILE_KINDS = ['photo', 'w9'] as const
export type CleanerFileKind = (typeof CLEANER_FILE_KINDS)[number]

/** The kind asked for in a query string or form. Anything but "w9" is the photo. */
export const cleanerFileKind = (value: unknown): CleanerFileKind => (value === 'w9' ? 'w9' : 'photo')

/** A W-9 may also be a PDF. */
const W9_TYPES: readonly string[] = [...PHOTO_TYPES, 'application/pdf']

/** Why this file cannot be the cleaner's photo or W-9, or null when it can. */
export function cleanerFileUploadProblem(kind: CleanerFileKind, file: { size: number; type: string }): string | null {
  const allowed: readonly string[] = kind === 'w9' ? W9_TYPES : PHOTO_TYPES
  if (!allowed.includes(file.type)) return kind === 'w9' ? 'Upload a PDF or an image' : 'Upload an image'
  if (file.size === 0) return 'That file is empty'
  if (file.size > PHOTO_MAX_BYTES) return 'That file is over 5MB'
  return null
}

/**
 * Where a page loads the file from, or null when there is none. The version
 * is the file's `updatedAt`.
 */
export function cleanerFileUrl(
  cleanerId: string,
  kind: CleanerFileKind,
  version: Date | string | null | undefined,
): string | null {
  if (!version) return null
  const at = typeof version === 'string' ? new Date(version).getTime() : version.getTime()
  return `/api/cleaners/${cleanerId}/files?kind=${kind}&v=${Number.isFinite(at) ? at : 0}`
}
