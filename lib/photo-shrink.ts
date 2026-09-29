/**
 * Shrink a picture in the browser before it is uploaded.
 *
 * A phone photo is 3 to 8MB; the biggest place a photo shows is a 96px card
 * band. Drawing it at 1200px as a JPEG keeps each one around 150KB, which
 * matters because photos live in the database.
 *
 * Browser only. If the browser cannot decode the file (HEIC in some browsers,
 * say), the original goes up unchanged and the server's own check decides.
 */

import { fitWithin } from "./photos"

const MAX_SIDE = 1200

export async function shrinkPhoto(file: File): Promise<Blob> {
  // An animated GIF would lose its animation; a small file is already fine.
  if (file.type === "image/gif" || file.size < 200 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    const size = fitWithin(bitmap.width, bitmap.height, MAX_SIDE)
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    // JPEG has no transparency: a transparent PNG would otherwise turn black.
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
