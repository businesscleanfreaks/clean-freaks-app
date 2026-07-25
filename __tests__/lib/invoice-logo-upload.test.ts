import { describe, expect, it } from 'vitest'
import {
  readInvoiceLogoUpload,
  INVOICE_LOGO_MAX_BYTES,
} from '@/lib/invoice-logo-upload'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

function fileOf(bytes: number[], name: string, type: string, padTo = 0): File {
  const data = new Uint8Array(Math.max(bytes.length, padTo))
  data.set(bytes)
  return new File([data], name, { type })
}

describe('readInvoiceLogoUpload', () => {
  it('accepts a PNG', async () => {
    const result = await readInvoiceLogoUpload(fileOf(PNG_MAGIC, 'logo.png', 'image/png'))
    expect(result.logoMimeType).toBe('image/png')
    expect(result.logoFileName).toBe('logo.png')
    expect(result.logoSize).toBeGreaterThan(0)
  })

  it('accepts a JPEG', async () => {
    const result = await readInvoiceLogoUpload(fileOf(JPEG_MAGIC, 'logo.jpg', 'image/jpeg'))
    expect(result.logoMimeType).toBe('image/jpeg')
  })

  it('rejects a missing or empty file', async () => {
    await expect(readInvoiceLogoUpload(null)).rejects.toThrow(/choose a logo/i)
    await expect(readInvoiceLogoUpload(new File([], 'logo.png', { type: 'image/png' }))).rejects.toThrow(
      /choose a logo/i,
    )
  })

  it('rejects a file over the size cap', async () => {
    const tooBig = fileOf(PNG_MAGIC, 'big.png', 'image/png', INVOICE_LOGO_MAX_BYTES + 1)
    await expect(readInvoiceLogoUpload(tooBig)).rejects.toThrow(/2 MB or smaller/i)
  })

  it('rejects SVG — the PDF renderer cannot draw it', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'logo.svg', {
      type: 'image/svg+xml',
    })
    await expect(readInvoiceLogoUpload(svg)).rejects.toThrow(/PNG or JPG/i)
  })

  it('trusts the file content, not the claimed mime type', async () => {
    // A text file masquerading as a PNG must still be rejected.
    const fake = new File(['not really an image'], 'evil.png', { type: 'image/png' })
    await expect(readInvoiceLogoUpload(fake)).rejects.toThrow(/PNG or JPG/i)

    // JPEG bytes with a .png name are stored as their real type.
    const mislabelled = fileOf(JPEG_MAGIC, 'photo.png', 'image/png')
    expect((await readInvoiceLogoUpload(mislabelled)).logoMimeType).toBe('image/jpeg')
  })

  it('sanitises the stored file name', async () => {
    const result = await readInvoiceLogoUpload(fileOf(PNG_MAGIC, 'my logo<>:"/\\|?*.png', 'image/png'))
    expect(result.logoFileName).not.toMatch(/[<>:"/\\|?*]/)
  })
})
