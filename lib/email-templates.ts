/** Email template helpers for invoice emails */

export function generateInvoiceSubject(invoiceNumber: string): string {
  return `Invoice ${invoiceNumber} from Clean Freaks`
}

export function getDefaultEmailMessage({
  clientName,
  invoiceNumber,
  total,
  totalAmount,
  dueDate,
}: {
  clientName?: string
  invoiceNumber?: string
  total?: string
  totalAmount?: string
  dueDate?: string | null
}): string {
  const amount = totalAmount || total || ''
  const dueLine = dueDate ? `\nPayment is due by ${dueDate}.` : ''
  const name = clientName || 'there'
  const inv = invoiceNumber ? ` Invoice ${invoiceNumber}` : ''
  return `Hi ${name},\n\nPlease find attached${inv} for ${amount}.${dueLine}\n\nThank you for your business!\n\nBest regards,\nClean Freaks`
}

/** Generate HTML email body for invoice sending */
export function generateInvoiceEmail({
  clientName,
  invoiceNumber,
  totalAmount,
  dueDate,
  invoiceUrl,
  customMessage,
  showPaymentOptions,
}: {
  clientName: string
  invoiceNumber: string
  totalAmount: string
  dueDate: string | null
  invoiceUrl: string
  customMessage?: string
  showPaymentOptions?: boolean
}): string {
  const dueLine = dueDate ? `<p>Payment is due by <strong>${dueDate}</strong>.</p>` : ''
  const messageLine = customMessage ? `<p>${customMessage.replace(/\n/g, '<br>')}</p>` : ''
  const paymentSection = showPaymentOptions
    ? `<p><a href="${invoiceUrl}" style="display:inline-block;padding:12px 24px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:600;">View Invoice</a></p>`
    : `<p><a href="${invoiceUrl}">View Invoice ${invoiceNumber}</a></p>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <h2 style="color:#0d9488;">Invoice ${invoiceNumber}</h2>
  <p>Hi ${clientName},</p>
  ${messageLine || `<p>Please find your invoice for <strong>${totalAmount}</strong>.</p>`}
  ${dueLine}
  ${paymentSection}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:13px;">Clean Freaks</p>
</body>
</html>`
}
