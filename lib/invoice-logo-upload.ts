export const INVOICE_LOGO_MAX_BYTES = 2 * 1024 * 1024 // 2 MB

/**
 * Formats the PDF renderer can actually draw. @react-pdf/renderer's <Image>
 * supports PNG and JPEG only — SVG is NOT supported as an image source, so it
 * is deliberately rejected here rather than accepted and silently dropped.
 */
export const INVOICE_LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const

export class InvoiceLogoUploadError extends Error {
  statusCode = 400
}

function cleanFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()]/g, '_').trim()
  return cleaned || 'logo.png'
}

function sniffMimeType(bytes: Buffer): string | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  return null
}

export interface InvoiceLogoUpload {
  logoFileName: string
  logoMimeType: string
  logoSize: number
  logoData: Buffer
}

/**
 * Validates an uploaded logo. The real content is sniffed from the file's magic
 * bytes rather than trusted from the client-supplied mime type, so a renamed or
 * mislabelled file can't get stored as something the PDF can't draw.
 */
export async function readInvoiceLogoUpload(file: File | null): Promise<InvoiceLogoUpload> {
  if (!file || file.size === 0) {
    throw new InvoiceLogoUploadError('Choose a logo file to upload.')
  }
  if (file.size > INVOICE_LOGO_MAX_BYTES) {
    throw new InvoiceLogoUploadError('Logo must be 2 MB or smaller.')
  }

  const data = Buffer.from(await file.arrayBuffer())
  const sniffed = sniffMimeType(data)
  if (!sniffed) {
    throw new InvoiceLogoUploadError('Logo must be a PNG or JPG image.')
  }

  return {
    logoFileName: cleanFileName(file.name || 'logo.png'),
    logoMimeType: sniffed,
    logoSize: data.length,
    logoData: data,
  }
}
