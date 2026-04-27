import { InvoiceLogoSettingsData } from './invoice-logo-settings'

/**
 * Calculate safe logo dimensions with constraints
 */
export function calculateLogoDimensions(
  settings: InvoiceLogoSettingsData,
  originalWidth?: number,
  originalHeight?: number
): { width: number; height: number } {
  // Calculate width with max constraint
  let width = Math.min(settings.width, settings.maxWidth)
  
  // Calculate height
  let height: number
  
  if (settings.height) {
    // Use specified height with max constraint
    height = Math.min(settings.height, settings.maxHeight)
  } else if (originalWidth && originalHeight) {
    // Maintain aspect ratio
    const aspectRatio = originalHeight / originalWidth
    height = width * aspectRatio
    // Apply max height constraint
    if (height > settings.maxHeight) {
      height = settings.maxHeight
      width = height / aspectRatio
    }
  } else {
    // Default aspect ratio (assume square-ish)
    height = width * 0.5
    if (height > settings.maxHeight) {
      height = settings.maxHeight
      width = height * 2
    }
  }
  
  return { width, height }
}

/**
 * Calculate logo position styles for PDF
 */
export function calculateLogoPosition(
  settings: InvoiceLogoSettingsData,
  pageWidth?: number, // A4 width in points (default: 612)
  pageHeight?: number, // A4 height in points (default: 792)
  pagePadding?: number // default: 40
): {
  position: 'absolute' | 'relative'
  left?: number
  right?: number
  top?: number
  bottom?: number
  alignItems?: 'flex-start' | 'center' | 'flex-end'
  justifyContent?: 'flex-start' | 'center' | 'flex-end'
} {
  const { positionX, positionY, customX, customY } = settings
  
  // Ensure parameters are numbers (they have defaults but TypeScript needs explicit handling)
  const safePageWidth = pageWidth ?? 612
  const safePageHeight = pageHeight ?? 792
  const safePagePadding = pagePadding ?? 40
  
  // If using custom positions, use absolute positioning
  if (positionX === 'custom' || positionY === 'custom') {
    const left = positionX === 'custom' && customX !== null && typeof customX === 'number'
      ? Math.max(safePagePadding, Math.min(customX, safePageWidth - safePagePadding))
      : undefined
    const top = positionY === 'custom' && customY !== null && typeof customY === 'number'
      ? Math.max(safePagePadding, Math.min(customY, safePageHeight - safePagePadding))
      : undefined
    
    return {
      position: 'absolute',
      ...(left !== undefined && { left }),
      ...(top !== undefined && { top }),
    }
  }
  
  // Use flexbox alignment for preset positions
  let alignItems: 'flex-start' | 'center' | 'flex-end' = 'flex-start'
  let justifyContent: 'flex-start' | 'center' | 'flex-end' = 'flex-start'
  
  switch (positionX) {
    case 'left':
      alignItems = 'flex-start'
      break
    case 'center':
      alignItems = 'center'
      break
    case 'right':
      alignItems = 'flex-end'
      break
  }
  
  switch (positionY) {
    case 'top':
      justifyContent = 'flex-start'
      break
    case 'middle':
      justifyContent = 'center'
      break
    case 'bottom':
      justifyContent = 'flex-end'
      break
  }
  
  return {
    position: 'relative',
    alignItems,
    justifyContent,
  }
}

/**
 * Validate logo settings and return any warnings
 */
export function validateLogoSettings(
  settings: InvoiceLogoSettingsData
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []
  
  // Check dimensions
  if (settings.width <= 0) {
    warnings.push('Width must be greater than 0')
  }
  if (settings.width > settings.maxWidth) {
    warnings.push(`Width (${settings.width}) exceeds max width (${settings.maxWidth})`)
  }
  if (settings.height && settings.height <= 0) {
    warnings.push('Height must be greater than 0')
  }
  if (settings.height && settings.height > settings.maxHeight) {
    warnings.push(`Height (${settings.height}) exceeds max height (${settings.maxHeight})`)
  }
  
  // Check custom positions
  if (settings.positionX === 'custom' && settings.customX === null) {
    warnings.push('Custom X position requires a value')
  }
  if (settings.positionY === 'custom' && settings.customY === null) {
    warnings.push('Custom Y position requires a value')
  }
  
  // Opacity is always 1.0 (removed from UI), so no validation needed
  
  // Check if logo path is set when enabled
  if (settings.enabled && !settings.logoPath) {
    warnings.push('Logo is enabled but no logo file is set')
  }
  
  return {
    valid: warnings.length === 0,
    warnings,
  }
}

