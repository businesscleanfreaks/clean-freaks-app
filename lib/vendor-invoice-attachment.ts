export const VENDOR_INVOICE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

export class VendorInvoiceAttachmentError extends Error {
  statusCode = 400
}

function cleanFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()]/g, '_').trim()
  return cleaned || 'vendor-invoice.pdf'
}

export async function readVendorInvoiceAttachment(file: File | null): Promise<{
  attachmentFileName: string
  attachmentMimeType: string
  attachmentSize: number
  attachmentData: Buffer
} | null> {
  if (!file || file.size === 0) return null

  const fileName = cleanFileName(file.name || 'vendor-invoice.pdf')
  const mimeType = file.type || 'application/pdf'
  const looksLikePdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')

  if (!looksLikePdf) {
    throw new VendorInvoiceAttachmentError('Vendor invoice attachment must be a PDF')
  }
  if (file.size > VENDOR_INVOICE_ATTACHMENT_MAX_BYTES) {
    throw new VendorInvoiceAttachmentError('Vendor invoice PDF must be 10 MB or smaller')
  }

  return {
    attachmentFileName: fileName,
    attachmentMimeType: 'application/pdf',
    attachmentSize: file.size,
    attachmentData: Buffer.from(await file.arrayBuffer()),
  }
}
