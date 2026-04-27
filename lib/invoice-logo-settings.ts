import { prisma } from '@/lib/db'

export interface InvoiceLogoSettingsData {
  logoPath?: string | null
  width: number
  height?: number | null
  positionX: 'left' | 'center' | 'right' | 'custom'
  positionY: 'top' | 'middle' | 'bottom' | 'custom'
  customX?: number | null
  customY?: number | null
  maxWidth: number
  maxHeight: number
  opacity: number
  enabled: boolean
}

const DEFAULT_SETTINGS: InvoiceLogoSettingsData = {
  logoPath: null,
  width: 100,
  height: null,
  positionX: 'left',
  positionY: 'top',
  customX: null,
  customY: null,
  maxWidth: 200,
  maxHeight: 100,
  opacity: 1.0,
  enabled: false,
}

/**
 * Get invoice logo settings from database
 * Returns default settings if none exist
 */
export async function getInvoiceLogoSettings(): Promise<InvoiceLogoSettingsData> {
  try {
    if (!prisma) {
      console.error('Prisma client is not initialized')
      return DEFAULT_SETTINGS
    }

    // Access the model - if it doesn't exist, Prisma will throw an error which we'll catch
    const settings = await prisma.invoiceLogoSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    })

    if (!settings) {
      return DEFAULT_SETTINGS
    }

    return {
      logoPath: settings.logoPath,
      width: settings.width,
      height: settings.height,
      positionX: settings.positionX as 'left' | 'center' | 'right' | 'custom',
      positionY: settings.positionY as 'top' | 'middle' | 'bottom' | 'custom',
      customX: settings.customX,
      customY: settings.customY,
      maxWidth: settings.maxWidth,
      maxHeight: settings.maxHeight,
      opacity: settings.opacity,
      enabled: settings.enabled,
    }
  } catch (error) {
    console.error('Error fetching invoice logo settings:', error)
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack)
    }
    return DEFAULT_SETTINGS
  }
}

/**
 * Save invoice logo settings to database
 */
export async function saveInvoiceLogoSettings(
  data: Partial<InvoiceLogoSettingsData>
): Promise<InvoiceLogoSettingsData> {
  try {
    if (!prisma) {
      throw new Error('Prisma client is not initialized. Please ensure the database is connected.')
    }

    // Get existing settings or create new
    let existing = null
    try {
      existing = await prisma.invoiceLogoSettings.findFirst({
        orderBy: { createdAt: 'desc' },
      })
    } catch (queryError) {
      console.error('Error querying existing settings:', queryError)
      throw new Error(`Failed to query existing settings: ${queryError instanceof Error ? queryError.message : 'Unknown error'}`)
    }

    const settingsData = {
      logoPath: data.logoPath ?? existing?.logoPath ?? DEFAULT_SETTINGS.logoPath,
      width: data.width ?? existing?.width ?? DEFAULT_SETTINGS.width,
      height: data.height !== undefined ? data.height : (existing?.height ?? DEFAULT_SETTINGS.height),
      positionX: data.positionX ?? existing?.positionX ?? DEFAULT_SETTINGS.positionX,
      positionY: data.positionY ?? existing?.positionY ?? DEFAULT_SETTINGS.positionY,
      customX: data.customX !== undefined ? data.customX : (existing?.customX ?? DEFAULT_SETTINGS.customX),
      customY: data.customY !== undefined ? data.customY : (existing?.customY ?? DEFAULT_SETTINGS.customY),
      maxWidth: data.maxWidth ?? existing?.maxWidth ?? DEFAULT_SETTINGS.maxWidth,
      maxHeight: data.maxHeight ?? existing?.maxHeight ?? DEFAULT_SETTINGS.maxHeight,
      opacity: data.opacity ?? existing?.opacity ?? DEFAULT_SETTINGS.opacity,
      enabled: data.enabled ?? existing?.enabled ?? DEFAULT_SETTINGS.enabled,
    }

    if (existing) {
      try {
        const updated = await prisma.invoiceLogoSettings.update({
          where: { id: existing.id },
          data: settingsData,
        })

        return {
          logoPath: updated.logoPath,
          width: updated.width,
          height: updated.height,
          positionX: updated.positionX as 'left' | 'center' | 'right' | 'custom',
          positionY: updated.positionY as 'top' | 'middle' | 'bottom' | 'custom',
          customX: updated.customX,
          customY: updated.customY,
          maxWidth: updated.maxWidth,
          maxHeight: updated.maxHeight,
          opacity: updated.opacity,
          enabled: updated.enabled,
        }
      } catch (updateError) {
        console.error('Error updating settings:', updateError)
        throw new Error(`Failed to update settings: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`)
      }
    } else {
      try {
        const created = await prisma.invoiceLogoSettings.create({
          data: settingsData,
        })

        return {
          logoPath: created.logoPath,
          width: created.width,
          height: created.height,
          positionX: created.positionX as 'left' | 'center' | 'right' | 'custom',
          positionY: created.positionY as 'top' | 'middle' | 'bottom' | 'custom',
          customX: created.customX,
          customY: created.customY,
          maxWidth: created.maxWidth,
          maxHeight: created.maxHeight,
          opacity: created.opacity,
          enabled: created.enabled,
        }
      } catch (createError) {
        console.error('Error creating settings:', createError)
        throw new Error(`Failed to create settings: ${createError instanceof Error ? createError.message : 'Unknown error'}`)
      }
    }
  } catch (error) {
    console.error('Error saving invoice logo settings:', error)
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack)
      throw error
    }
    throw new Error('Failed to save invoice logo settings: Unknown error')
  }
}

/**
 * Delete invoice logo settings
 */
export async function deleteInvoiceLogoSettings(): Promise<void> {
  try {
    await prisma.invoiceLogoSettings.deleteMany({})
  } catch (error) {
    console.error('Error deleting invoice logo settings:', error)
    throw error
  }
}

