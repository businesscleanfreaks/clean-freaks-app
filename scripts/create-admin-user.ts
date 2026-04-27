import * as path from 'path'
import * as fs from 'fs'

// Load .env.local manually — tsx/node doesn't auto-load it like Next.js does.
// This MUST run before importing lib/db, which reads DATABASE_URL at import time.
const envPath = path.resolve(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
  console.log('✅ Loaded environment from .env.local')
} else {
  console.warn('⚠️  .env.local not found at:', envPath)
}

// Dynamic imports — these run AFTER env vars are loaded above
async function main() {
  const { prisma } = await import('../lib/db')
  const { hashPassword } = await import('../lib/auth')

  const email = process.env.ADMIN_EMAIL || 'admin@cleanfreaks.com'
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  const name = process.env.ADMIN_NAME || 'Admin User'

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  })

  if (existingUser) {
    console.log(`User with email ${email} already exists.`)
    await prisma.$disconnect()
    return
  }

  // Create admin user
  const passwordHash = await hashPassword(password)
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
    },
  })

  console.log(`✅ Admin user created successfully!`)
  console.log(`   Email: ${user.email}`)
  console.log(`   Name: ${user.name}`)
  console.log(`   Password: ${password}`)
  console.log(`\n⚠️  Please change the default password after first login!`)

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Error creating admin user:', error)
  process.exit(1)
})
