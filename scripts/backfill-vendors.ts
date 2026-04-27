/**
 * Backfill migration: Convert outsourcedVendor strings to Vendor records
 * 
 * Run with: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-vendors.ts
 * Or: npx tsx scripts/backfill-vendors.ts
 * 
 * Safe to run multiple times — uses upsert on vendor name.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting vendor backfill migration...')

  // Find all distinct non-empty outsourcedVendor values
  const addOnsWithVendor = await prisma.addOnService.findMany({
    where: {
      outsourcedVendor: { not: null },
      vendorId: null, // Only process un-migrated records
    },
    select: {
      id: true,
      outsourcedVendor: true,
    },
  })

  if (addOnsWithVendor.length === 0) {
    console.log('No outsourcedVendor strings to migrate. Done.')
    return
  }

  // Get distinct vendor names
  const vendorNames = [...new Set(
    addOnsWithVendor
      .map(a => a.outsourcedVendor?.trim())
      .filter((name): name is string => !!name)
  )]

  console.log(`Found ${vendorNames.length} distinct vendor name(s): ${vendorNames.join(', ')}`)

  // Create/upsert Vendor records
  const vendorMap = new Map<string, string>() // name -> id

  for (const name of vendorNames) {
    const vendor = await prisma.vendor.upsert({
      where: { name },
      create: { name },
      update: {},
    })
    vendorMap.set(name, vendor.id)
    console.log(`  Vendor "${name}" -> ${vendor.id}`)
  }

  // Update AddOnService records to link to Vendor
  let updated = 0
  for (const addon of addOnsWithVendor) {
    const vendorName = addon.outsourcedVendor?.trim()
    if (!vendorName) continue

    const vendorId = vendorMap.get(vendorName)
    if (!vendorId) continue

    await prisma.addOnService.update({
      where: { id: addon.id },
      data: { vendorId },
    })
    updated++
  }

  console.log(`Updated ${updated} add-on service(s) with vendor IDs.`)
  console.log('Backfill complete. The outsourcedVendor column can be removed after verification.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
