import * as React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import { InvoiceWithRelations } from '@/types'
import path from 'path'
import { existsSync } from 'fs'
import { logger } from '@/lib/logger'
import { buildInvoiceDocument } from '@/lib/invoice-document'
import { buildPaymentBlock, printsNoPaymentSection } from '@/lib/invoice-payment-block'
import type { InvoiceFooterTemplates } from '@/lib/billing-sections'

// Colors matching the provided Clean Freaks invoice template
const COLORS = {
  navyBlue: '#1B3A5C',       // Dark navy for headers, labels
  templateBlue: '#3B7DD8',   // Table header blue
  lightBlue: '#EAF0F6',      // Alternating row background
  accentTeal: '#5EADAC',     // Total row highlight
  textDark: '#1f2937',       // Body text
  textMuted: '#4b5563',      // Secondary text
  textLight: '#6b7280',      // Tertiary text
  white: '#ffffff',
  borderLight: '#D6DEE6',    // Table borders
  footerBg: '#1B3A5C',       // Footer background
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 80,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: COLORS.textDark,
    backgroundColor: COLORS.white,
  },
  // ─── Header ───
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  logoContainer: {
    alignItems: 'flex-start',
  },
  invoiceTitleBlock: {
    alignItems: 'flex-end',
  },
  invoiceTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: COLORS.navyBlue,
    letterSpacing: 1,
    textAlign: 'center',
  },
  metaLabel: {
    fontSize: 8.5,
    fontWeight: 'bold',
    color: COLORS.templateBlue,
    textAlign: 'right',
  },
  metaValue: {
    fontSize: 10.5,
    color: COLORS.textDark,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 5,
  },
  // ─── Bill To / Point of Contact ───
  billToSection: {
    marginBottom: 20,
  },
  billToRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 40,
    marginBottom: 20,
  },
  billToColumn: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.navyBlue,
    marginBottom: 6,
  },
  billToName: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 2,
  },
  billToText: {
    fontSize: 9,
    color: COLORS.textDark,
    marginBottom: 1,
    lineHeight: 1.4,
  },
  // ─── Line Items Table ───
  table: {
    marginTop: 8,
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.templateBlue,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tableHeaderText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderLight,
  },
  tableRowAlt: {
    backgroundColor: COLORS.lightBlue,
  },
  colDescription: { flex: 3 },
  colQuantity: { flex: 1, textAlign: 'center' },
  colRate: { flex: 1, textAlign: 'right' },
  colAmount: { flex: 1, textAlign: 'right' },
  // ─── Document header (design, 2026-09-08) ───
  docHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 26,
  },
  wordmark: {
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1.1,
    color: COLORS.textDark,
  },
  docTitle: {
    fontSize: 26,
    letterSpacing: 3.4,
    color: COLORS.borderLight,
  },
  metaColumn: {
    alignItems: 'flex-end',
  },
  metaPair: {
    alignItems: 'flex-end',
    marginBottom: 7,
  },
  // The amount due sits above the table as well as below it.
  totalDueBlock: {
    alignItems: 'flex-end',
    borderTopWidth: 0.5,
    borderTopColor: COLORS.borderLight,
    paddingTop: 12,
    marginBottom: 18,
  },
  totalDueLabel: {
    fontSize: 8,
    letterSpacing: 0.9,
    color: COLORS.textMuted,
    marginBottom: 3,
  },
  totalDueValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  grandTotalLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  grandTotalValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  footerNoteText: {
    fontSize: 8.5,
    color: COLORS.textMuted,
  },
  tableText: {
    fontSize: 9,
    color: COLORS.textDark,
  },
  // ─── Totals ───
  totalsSection: {
    marginTop: 12,
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 180,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderLight,
  },
  totalRowFinal: {
    backgroundColor: COLORS.accentTeal,
    borderBottomWidth: 0,
    paddingVertical: 8,
    marginTop: 2,
  },
  totalLabel: {
    fontSize: 10,
    color: COLORS.textDark,
  },
  totalValue: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  totalLabelFinal: {
    fontSize: 10,
    color: COLORS.white,
    fontWeight: 'bold',
  },
  totalValueFinal: {
    fontSize: 10,
    color: COLORS.white,
    fontWeight: 'bold',
  },
  // ─── Payment Section ───
  paymentSection: {
    marginTop: 16,
    marginBottom: 8,
    flexDirection: 'row',
    gap: 30,
  },
  paymentLeft: {
    flex: 1,
  },
  paymentRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  paymentTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.navyBlue,
    marginBottom: 6,
  },
  paymentLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 2,
  },
  paymentValue: {
    fontSize: 9,
    color: COLORS.textDark,
    marginBottom: 1,
  },
  paymentDba: {
    fontSize: 8,
    color: COLORS.textLight,
    fontFamily: 'Helvetica-Oblique',
  },
  paidToLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.navyBlue,
    marginBottom: 6,
  },
  // Payment instructions print as a plain full-width line above the footer,
  // not as a headline in the "Paid to" column.
  instructionsRow: {
    marginTop: 12,
  },
  instructionsText: {
    fontSize: 9,
    color: COLORS.textMuted,
    lineHeight: 1.4,
  },
  // ─── Fee Notice ───
  feeNotice: {
    marginTop: 12,
    marginBottom: 8,
  },
  feeText: {
    fontSize: 8,
    color: COLORS.textMuted,
    marginBottom: 1,
  },
  feeTextItalic: {
    fontSize: 8,
    color: COLORS.textMuted,
    fontFamily: 'Helvetica-Oblique',
  },
  // ─── Footer ───
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.footerBg,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  footerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerIconBox: {
    width: 22,
    height: 22,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerIconText: {
    fontSize: 10,
    color: COLORS.white,
  },
  footerTextGroup: {},
  footerBold: {
    fontSize: 8,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  footerSub: {
    fontSize: 7,
    color: '#94A3B8',
    marginTop: 1,
  },
})

export interface LogoSettings {
  positionX: 'left' | 'center' | 'right'
  width: number
  maxHeight: number
}

const DEFAULT_LOGO_SETTINGS: LogoSettings = {
  positionX: 'left',
  width: 180,
  maxHeight: 70,
}

export interface InvoiceBusinessInfo {
  businessName?: string | null
  legalName?: string | null
  email?: string | null
  phone?: string | null
  paymentEmail?: string | null
}

// Current invoice identity — kept as fallbacks so the PDF is unchanged until
// the business profile fields are filled in under Settings → Business profile.
const BUSINESS_FALLBACK = {
  businessName: 'The Clean Freaks',
  legalName: 'Shiloh Pro Cleaning Services',
  email: 'admin@thecleanfreaks.co',
  phone: '(323) 746-0324',
  paymentEmail: 'admin@thecleanfreaks.co',
}

interface InvoicePDFProps {
  invoice: InvoiceWithRelations
  logoSettings?: LogoSettings
  business?: InvoiceBusinessInfo
  footerNote?: string | null
  /**
   * How THIS client pays us: ZELLE | ACH | PORTAL | CHECK. Drives the payment
   * section · without it the invoice used to tell everyone to pay by Zelle.
   */
  payMethod?: string | null
  /** Per-method note templates, so the block resolves the note for its method. */
  footerTemplates?: InvoiceFooterTemplates | null
  /** Uploaded logo as a data URI; takes precedence over the bundled logo file. */
  uploadedLogo?: string | null
}

export function InvoicePDF({ invoice, logoSettings, business, footerNote, payMethod, footerTemplates, uploadedLogo }: InvoicePDFProps) {
  const settings = logoSettings || DEFAULT_LOGO_SETTINGS

  // Resolve the business identity, falling back to the previously hardcoded values.
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  const bizFooterNote = clean(footerNote)
  const bizName = clean(business?.businessName) || BUSINESS_FALLBACK.businessName
  const bizLegal = clean(business?.legalName) || BUSINESS_FALLBACK.legalName
  const bizEmail = clean(business?.email) || BUSINESS_FALLBACK.email
  const bizPhone = clean(business?.phone) || BUSINESS_FALLBACK.phone
  const bizPaymentEmail = clean(business?.paymentEmail) || BUSINESS_FALLBACK.paymentEmail
  // The legal entity is the payment "Full Name"; show the DBA line only when the
  // display name genuinely differs from the legal name.
  const bizDba = bizLegal !== bizName ? `(DBA ${bizName})` : null

  // Everything the payment section prints, decided in one tested place so the
  // PDF and the on-screen preview cannot disagree.
  const paymentBlock = buildPaymentBlock({
    payMethod,
    // No client has a pay method recorded yet, so this keeps the business's
    // usual method printing until they are set. A client's own method always
    // wins, so setting one to the portal takes effect immediately.
    fallbackMethod: 'ZELLE',
    paymentEmail: bizPaymentEmail,
    legalName: bizLegal,
    dba: bizDba,
    mailingAddress: null,
    templates: footerTemplates ?? null,
    genericNote: bizFooterNote,
  })

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })
  }

  // Get client address from first location with safe fallbacks
  const clientAddress = invoice.client.locations?.[0] || {
    address: null,
    city: null,
    state: null,
    zipCode: null,
  }

  // Group per-clean visits into summary lines (flat-rate left unchanged).
  // The same model the on-screen preview renders, so "What your client
  // receives" is literally what they receive.
  const doc = buildInvoiceDocument({
    businessName: bizName,
    businessPhone: bizPhone,
    clientName: invoice.client.name,
    clientAddress: [clientAddress.address, clientAddress.city].filter(Boolean).join(', '),
    invoiceNumber: invoice.invoiceNumber,
    issuedDate: invoice.dateCreated,
    dueDate: invoice.dateDue,
    billingType: invoice.client.billingType,
    lineItems: invoice.lineItems,
    total: invoice.totalAmount,
    monthLabel: formatDate(invoice.dateCreated),
    locations: (invoice.lineItems ?? [])
      .map((li) => (li as { locationName?: string | null }).locationName)
      .filter((name, index, all): name is string => !!name && all.indexOf(name) === index)
      .map((name) => ({ name })),
  })

  // Point of contact
  const contactName = invoice.client.communicationContactName || invoice.client.name
  const contactEmail = invoice.client.communicationEmail || invoice.client.invoicingEmail || null
  const contactPhone = invoice.client.communicationPhone || invoice.client.phone || null

  // Logo: an uploaded logo (Settings → Business profile, stored in the DB and
  // passed in as a data URI) wins; otherwise fall back to the bundled file.
  const logoFilePath = path.join(process.cwd(), 'public', 'images', 'invoice-logo.png')
  const logoExists = existsSync(logoFilePath)

  let logoSrc: string | null = null
  let showLogoInHeader = false

  if (uploadedLogo) {
    logoSrc = uploadedLogo
    showLogoInHeader = true
  } else if (logoExists) {
    try {
      const fs = require('fs')
      const stats = fs.statSync(logoFilePath)
      if (stats.isFile()) {
        try {
          const logoBuffer = fs.readFileSync(logoFilePath)
          const logoBase64 = logoBuffer.toString('base64')
          logoSrc = `data:image/png;base64,${logoBase64}`
        } catch (base64Error) {
          logger.warn('[InvoicePDF] Could not convert logo to base64:', base64Error)
          logoSrc = '/images/invoice-logo.png'
        }
        showLogoInHeader = true
      }
    } catch (error) {
      logger.warn('[InvoicePDF] Logo file exists but could not be loaded:', error)
      logoSrc = null
    }
  } else {
    logger.debug('[InvoicePDF] Logo not found at:', logoFilePath, '- using placeholder')
  }

  const logoElement = showLogoInHeader && logoSrc ? (
    <View style={styles.logoContainer}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image component doesn't support alt prop */}
      <Image
        src={logoSrc}
        style={{
          width: settings.width,
          maxHeight: settings.maxHeight,
          objectFit: 'contain',
        }}
      />
    </View>
  ) : (
    <View style={{ width: settings.width, height: 50, backgroundColor: COLORS.navyBlue, borderRadius: 4, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold', textAlign: 'center' }}>THE CLEAN{'\n'}FREAKS</Text>
    </View>
  )

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ─── Header: wordmark left, INVOICE right ─── */}
        <View style={styles.docHeader} break={false} minPresenceAhead={150}>
          <Text style={styles.wordmark}>{doc.wordmark}</Text>
          <Text style={styles.docTitle}>{doc.title}</Text>
        </View>

        {/* ─── Bill to (left) · invoice facts (right) ─── */}
        <View style={styles.billToRow} break={false}>
          <View style={styles.billToColumn}>
            <Text style={styles.sectionLabel}>BILL TO</Text>
            <Text style={styles.billToName}>{doc.billTo.name}</Text>
            {doc.billTo.address && <Text style={styles.billToText}>{doc.billTo.address}</Text>}
          </View>
          <View style={styles.metaColumn}>
            {doc.meta.map((pair) => (
              <View key={pair.label} style={styles.metaPair}>
                <Text style={styles.metaLabel}>{pair.label}</Text>
                <Text style={styles.metaValue}>{pair.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ─── Amount due, before the detail ─── */}
        <View style={styles.totalDueBlock} break={false}>
          <Text style={styles.totalDueLabel}>{doc.totalDueLabel}</Text>
          <Text style={styles.totalDueValue}>{doc.totalDue}</Text>
        </View>

        {/* ─── Line items: description · qty · rate · amount ─── */}
        <View style={styles.table}>
          <View style={styles.tableHeader} break={false}>
            <Text style={[styles.colDescription, styles.tableHeaderText]}>{doc.columns.description}</Text>
            <Text style={[styles.colQuantity, styles.tableHeaderText]}>{doc.columns.quantity}</Text>
            <Text style={[styles.colRate, styles.tableHeaderText]}>{doc.columns.rate}</Text>
            <Text style={[styles.colAmount, styles.tableHeaderText]}>{doc.columns.amount}</Text>
          </View>
          {doc.rows.map((row, index: number) => (
            <View key={index} style={styles.tableRow} wrap={false}>
              <Text style={[styles.colDescription, styles.tableText]}>{row.description}</Text>
              <Text style={[styles.colQuantity, styles.tableText]}>{row.quantity ?? ''}</Text>
              <Text style={[styles.colRate, styles.tableText]}>{row.rate ?? ''}</Text>
              <Text style={[styles.colAmount, styles.tableText]}>{row.amount ?? ''}</Text>
            </View>
          ))}
          <View style={styles.grandTotalRow} wrap={false}>
            <Text style={styles.grandTotalLabel}>{doc.totalLabel}</Text>
            <Text style={styles.grandTotalValue}>{doc.total}</Text>
          </View>
        </View>

        {/* ─── Payment ─── */}
        <View break={false}>
          {/* Payment Section — this client's method only.
              A portal client prints none of this: they pay through their own
              AP system, so our details would invite a second payment. */}
          {!printsNoPaymentSection(paymentBlock) && (
            <View style={styles.paymentSection}>
              <View style={styles.paymentLeft}>
                {paymentBlock.title && (
                  <Text style={styles.paymentTitle}>{paymentBlock.title}</Text>
                )}
                {paymentBlock.details.map((detail, index) => (
                  <View
                    key={detail.label}
                    style={index < paymentBlock.details.length - 1 ? { marginBottom: 6 } : undefined}
                  >
                    <Text style={styles.paymentLabel}>{detail.label}</Text>
                    <Text style={styles.paymentValue}>{detail.value}</Text>
                    {detail.sub && <Text style={styles.paymentDba}>{detail.sub}</Text>}
                  </View>
                ))}
              </View>
              <View style={styles.paymentRight}>
                <Text style={styles.paidToLabel}>Paid to {bizName}</Text>
              </View>
            </View>
          )}

          {/* Payment instructions · plain text across the page, above the
              footer. They used to render as a large italic line inside the
              "Paid to" column, which read as a signature rather than as the
              instruction the client is meant to act on. */}
          {paymentBlock.instructions && (
            <View style={styles.instructionsRow}>
              <Text style={styles.instructionsText}>{paymentBlock.instructions}</Text>
            </View>
          )}

          {/* Fee Notice */}
          {paymentBlock.showFeeNotice && (
            <View style={styles.feeNotice}>
              <Text style={styles.feeText}>Please request another method if needed</Text>
              <Text style={styles.feeTextItalic}>
                (Debit (3.5% fee), Credit (3.5% fee), PayPal (~3% fee), or Bank Transfer.
              </Text>
            </View>
          )}
        </View>

        {/* ─── Footer ─── */}
        {/* Footer: a plain row, thank-you left and phone right. The icon
            panel it replaces repeated the business name three times and put
            emoji on a document a client files with their accounts. */}
        <View style={styles.footer} fixed>
          <View style={styles.footerContent}>
            <Text style={styles.footerNoteText}>{doc.footer.left}</Text>
            {doc.footer.right && <Text style={styles.footerNoteText}>{doc.footer.right}</Text>}
          </View>
        </View>
      </Page>
    </Document>
  )
}
