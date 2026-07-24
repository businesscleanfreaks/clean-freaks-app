import * as React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import { InvoiceWithRelations } from '@/types'
import path from 'path'
import { existsSync } from 'fs'
import { logger } from '@/lib/logger'
import { groupInvoiceLineItems } from '@/lib/invoice-grouping'

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
    gap: 40,
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
  colPrice: { flex: 1, textAlign: 'right' },
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
  thankYouText: {
    fontFamily: 'Helvetica-Oblique',
    fontSize: 13,
    color: COLORS.navyBlue,
    marginTop: 4,
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
}

export function InvoicePDF({ invoice, logoSettings, business }: InvoicePDFProps) {
  const settings = logoSettings || DEFAULT_LOGO_SETTINGS

  // Resolve the business identity, falling back to the previously hardcoded values.
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
  const bizName = clean(business?.businessName) || BUSINESS_FALLBACK.businessName
  const bizLegal = clean(business?.legalName) || BUSINESS_FALLBACK.legalName
  const bizEmail = clean(business?.email) || BUSINESS_FALLBACK.email
  const bizPhone = clean(business?.phone) || BUSINESS_FALLBACK.phone
  const bizPaymentEmail = clean(business?.paymentEmail) || BUSINESS_FALLBACK.paymentEmail
  // The legal entity is the payment "Full Name"; show the DBA line only when the
  // display name genuinely differs from the legal name.
  const bizDba = bizLegal !== bizName ? `(DBA ${bizName})` : null

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
  const groupedRows = groupInvoiceLineItems(invoice.lineItems, { billingType: invoice.client.billingType })

  // Point of contact
  const contactName = invoice.client.communicationContactName || invoice.client.name
  const contactEmail = invoice.client.communicationEmail || invoice.client.invoicingEmail || null
  const contactPhone = invoice.client.communicationPhone || invoice.client.phone || null

  // Logo loading
  const logoFilePath = path.join(process.cwd(), 'public', 'images', 'invoice-logo.png')
  const logoExists = existsSync(logoFilePath)

  let logoSrc: string | null = null
  let showLogoInHeader = false

  if (logoExists) {
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
        {/* ─── Header: logo (left) · INVOICE (center) · meta (right) ─── */}
        <View style={styles.header} break={false} minPresenceAhead={150}>
          <View style={{ flex: 1 }}>
            {logoElement}
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={styles.metaLabel}>Invoice #:</Text>
            <Text style={styles.metaValue}>{invoice.invoiceNumber}</Text>
            <Text style={styles.metaLabel}>Invoice Date:</Text>
            <Text style={styles.metaValue}>{formatDate(invoice.dateCreated)}</Text>
            {invoice.dateDue && <Text style={styles.metaLabel}>Due Date:</Text>}
            {invoice.dateDue && <Text style={styles.metaValue}>{formatDate(invoice.dateDue)}</Text>}
          </View>
        </View>

        {/* ─── Bill To, then Point of Contact stacked beneath it (matches reference) ─── */}
        <View style={styles.billToSection} break={false}>
          <Text style={styles.sectionLabel}>Bill to:</Text>
          <Text style={styles.billToName}>{invoice.client.name}</Text>
          {clientAddress.address && (
            <Text style={styles.billToText}>{clientAddress.address}</Text>
          )}
          {clientAddress.city && (
            <Text style={styles.billToText}>
              {clientAddress.city}, {clientAddress.state || 'CA'} {clientAddress.zipCode || ''}
            </Text>
          )}

          <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Point of Contact:</Text>
          <Text style={styles.billToText}>{contactName}</Text>
          {contactEmail && (
            <Text style={styles.billToText}>{contactEmail}</Text>
          )}
          {contactPhone && (
            <Text style={styles.billToText}>{contactPhone}</Text>
          )}
        </View>

        {/* ─── Line Items Table ─── */}
        <View style={styles.table}>
          <View style={styles.tableHeader} break={false}>
            <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
            <Text style={[styles.colQuantity, styles.tableHeaderText]}>Quantity</Text>
            <Text style={[styles.colPrice, styles.tableHeaderText]}>Price</Text>
          </View>
          {groupedRows.map((row, index: number) => (
            <View
              key={row.key}
              style={[styles.tableRow, ...(index % 2 === 1 ? [styles.tableRowAlt] : [])]}
              wrap={false}
            >
              <Text style={[styles.colDescription, styles.tableText]}>
                {row.description}
              </Text>
              <Text style={[styles.colQuantity, styles.tableText]}>{row.quantity}</Text>
              <Text style={[styles.colPrice, styles.tableText]}>
                {formatCurrency(row.amount)}
              </Text>
            </View>
          ))}
        </View>

        {/* ─── Totals + Payment — Keep together ─── */}
        <View break={false}>
          {/* Totals */}
          <View style={styles.totalsSection}>
            <View style={styles.totalRow} wrap={false}>
              <Text style={styles.totalLabel}>Sub Total</Text>
              <Text style={styles.totalValue}>{formatCurrency(invoice.totalAmount)}</Text>
            </View>
            <View style={styles.totalRow} wrap={false}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>n/a</Text>
            </View>
            <View style={[styles.totalRow, styles.totalRowFinal]} wrap={false}>
              <Text style={styles.totalLabelFinal}>Total</Text>
              <Text style={styles.totalValueFinal}>{formatCurrency(invoice.totalAmount)}</Text>
            </View>
          </View>

          {/* Payment Section — Two columns */}
          <View style={styles.paymentSection}>
            <View style={styles.paymentLeft}>
              <Text style={styles.paymentTitle}>Preferred Payment Option:</Text>
              <View style={{ marginBottom: 6 }}>
                <Text style={styles.paymentLabel}>Zelle</Text>
                <Text style={styles.paymentValue}>{bizPaymentEmail}</Text>
              </View>
              <View>
                <Text style={styles.paymentLabel}>Full Name</Text>
                <Text style={styles.paymentValue}>{bizLegal}</Text>
                {bizDba && <Text style={styles.paymentDba}>{bizDba}</Text>}
              </View>
            </View>
            <View style={styles.paymentRight}>
              <Text style={styles.paidToLabel}>Paid to {bizName}</Text>
              <Text style={styles.thankYouText}>Thank you for your business!</Text>
            </View>
          </View>

          {/* Fee Notice */}
          <View style={styles.feeNotice}>
            <Text style={styles.feeText}>Please request another method if needed</Text>
            <Text style={styles.feeTextItalic}>
              (Debit (3.5% fee), Credit (3.5% fee), PayPal (~3% fee), or Bank Transfer.
            </Text>
          </View>
        </View>

        {/* ─── Footer ─── */}
        <View style={styles.footer} fixed>
          <View style={styles.footerContent}>
            <View style={styles.footerItem}>
              <View style={styles.footerIconBox}>
                <Text style={styles.footerIconText}>📞</Text>
              </View>
              <View style={styles.footerTextGroup}>
                <Text style={styles.footerBold}>{bizPhone}</Text>
                <Text style={styles.footerSub}>{bizName}</Text>
              </View>
            </View>
            <View style={styles.footerItem}>
              <View style={styles.footerIconBox}>
                <Text style={styles.footerIconText}>🌐</Text>
              </View>
              <View style={styles.footerTextGroup}>
                <Text style={styles.footerBold}>{bizEmail}</Text>
                <Text style={styles.footerSub}>{bizName}</Text>
              </View>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
