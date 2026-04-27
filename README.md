# 🧹 The Clean Freaks — Business Management System

A modern, all-in-one web application designed to streamline commercial cleaning business operations. From scheduling jobs to invoicing clients and managing your cleaning team — everything you need is in one place.

**Status**: Production Ready | **Last Updated**: April 27, 2026 | **Version**: 1.0

## 📋 What Can You Do?

### 👥 Client Management
- Add and manage all your clients in one place
- Track multiple locations per client
- Store contact information and billing preferences
- View client history and outstanding invoices

### 📅 Smart Scheduling
- Create recurring schedules (weekly, bi-weekly, monthly, custom)
- Automatic job generation from schedules
- Visual calendar view with drag-and-drop job assignment
- Color-coded cleaner assignments for quick visual identification

### 💰 Professional Invoicing
- Batch invoice generation from completed jobs
- Automatic PDF creation and email delivery
- Custom date ranges and flexible billing
- Track payment status (Draft → Sent → Paid)
- Support for flat-rate and per-service billing

### 🧑‍💼 Team Management
- Manage subcontractors and cleaning teams
- Track job assignments and completion
- Automated payment tracking and reports
- View earnings statements by team member

### 📊 Real-Time Dashboard
- Business metrics at a glance
- Today's job checklist
- Overdue invoices alert
- Quick access to key data

### 🔍 Global Search
- Search across all data: Clients, cleaners, locations, invoices
- Quick command palette (⌘K / Ctrl+K)
- Find anything in seconds

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 14, React 18, TypeScript | Modern React framework with server components |
| **Styling** | Tailwind CSS, shadcn/ui | Beautiful, responsive UI components |
| **Database** | PostgreSQL (Supabase), Prisma ORM | Reliable data persistence with type-safe queries |
| **PDF Generation** | @react-pdf/renderer | Professional invoice PDFs |
| **Date & Time** | date-fns | Lightweight date manipulation |
| **Data Fetching** | SWR | Client-side caching and real-time updates |
| **Authentication** | NextAuth.js | Secure session management |

## 📁 Project Structure

```
clean-freaks-app/
├── app/                        # Next.js App Router
│   ├── api/                    # Backend API routes
│   │   ├── clients/            # Client operations
│   │   ├── jobs/               # Job management
│   │   ├── invoices/           # Invoicing system
│   │   ├── schedules/          # Scheduling engine
│   │   ├── subcontractors/     # Team management
│   │   └── search/             # Global search
│   ├── clients/                # Client pages
│   ├── calendar/               # Calendar UI
│   ├── invoices/               # Invoice pages
│   ├── dashboard/              # Main dashboard
│   └── layout.tsx              # Root layout
│
├── components/                 # React components
│   ├── ui/                     # Reusable UI elements
│   ├── clients/                # Client-related components
│   ├── calendar/               # Calendar-specific components
│   ├── invoices/               # Invoice components
│   └── subcontractors/         # Team components
│
├── lib/                        # Business logic & utilities
│   ├── db.ts                   # Database connection
│   ├── auth.ts                 # Authentication
│   ├── invoice-calculations.ts # Billing logic
│   ├── regenerate-schedule-jobs.ts # Auto-scheduling
│   └── utils.ts                # Helper functions
│
├── prisma/                     # Database schema
│   ├── schema.prisma           # Data models
│   └── migrations/             # Database migrations
│
└── public/                     # Static files
    └── images/                 # Logos and assets
```

## 💾 Database Models

Your data is organized into these main entities:

| Entity | What It Does |
|--------|-------------|
| **Client** | Companies you clean for |
| **Location** | Addresses within each client |
| **Schedule** | Recurring cleaning jobs (weekly, bi-weekly, etc.) |
| **Job** | Individual cleaning tasks |
| **Invoice** | Bills sent to clients |
| **Subcontractor** | Your cleaning team members |
| **Payment** | Payments to cleaners |
| **AddOnService** | Extra services with custom pricing |



## 🔧 Development Guide

### Running the App

```bash
# Development server with hot reload
npm run dev

# Build for production
npm build

# Start production server
npm start

# Run tests
npm test

# Type checking
npm run type-check
```

### Code Structure Philosophy

We follow the **Custom Hook + Thin Component** pattern:

- **Hooks** (in `components/`): Contain all state, API calls, and business logic
- **Components**: Act as presentational layers, just rendering what the hooks provide
- **Sub-components**: Handle smaller UI sections, keeping complexity low

This keeps components focused, testable, and reusable.

## 📊 Common Tasks

### Adding a New Client
1. Go to **Clients** → **New Client**
2. Fill in business info and billing type
3. Add locations (addresses where you'll clean)
4. Add contact information
5. Create schedules for recurring jobs

### Creating a Recurring Schedule
1. Go to **Clients** → Select a client
2. **Schedules** tab → **New Schedule**
3. Choose frequency (weekly, bi-weekly, monthly)
4. Set rates and assign a cleaner
5. Jobs auto-generate based on the schedule

### Invoicing
1. Go to **Invoices** → **New Invoice**
2. Select client and date range
3. Review jobs to include
4. Generate PDF preview
5. Send via email or mark as sent

### Managing Your Team
1. Go to **Subcontractors**
2. Add team members with hourly/flat rates
3. Assign jobs from the calendar
4. Track payments and generate payment reports

## 🚀 Deployment

### Deploy to Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

Then configure these environment variables in Vercel:
- `DATABASE_URL`
- `SESSION_SECRET`
- `NEXT_PUBLIC_BASE_URL` (your production URL)

**[Detailed Vercel Setup →](https://vercel.com/docs)**

### Deploy to Other Platforms

This is a Next.js app, so it works on any platform that supports Node.js:
- **Railway**
- **Heroku**
- **AWS**
- **DigitalOcean**
- **Self-hosted servers**

## ❓ Troubleshooting

### "Database connection failed"
- Check that `DATABASE_URL` in `.env.local` is correct
- Ensure your Supabase project is active
- Test connection: `npx prisma db execute --stdin < test.sql`

### "Port 3000 already in use"
- Kill the process: `lsof -ti:3000 | xargs kill -9` (Mac/Linux)
- Or use a different port: `npm run dev -- -p 3001`

### "Prisma client out of sync"
```bash
npx prisma generate
npx prisma db push
```

### "Email not sending"
- Set `ENABLE_EMAIL_SENDING=true` in `.env.local`
- Check email service configuration
- Verify SMTP credentials are correct

## 📚 Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma ORM Guide](https://www.prisma.io/docs/)
- [Tailwind CSS](https://tailwindcss.com)
- [shadcn/ui Components](https://ui.shadcn.com)

## 🤝 Contributing

Found a bug or want to suggest a feature? Please reach out to the development team.

## 📄 License

This project is proprietary software for The Clean Freaks Janitorial Services.

---

**Questions?** Contact: `admin@cleanfreaks.com`

### Scheduling Engine (`lib/regenerate-schedule-jobs.ts`)

- Generates jobs 3 months ahead based on frequency rules
- Supports: WEEKLY, BI_WEEKLY, EVERY_3_WEEKS, EVERY_4_WEEKS, MONTHLY, 2X_MONTHLY, CUSTOM
- Monthly patterns: Fixed dates (`[1, 15]`) or Nth weekday (`2nd & 4th Tuesday`)
- **Historical data protection**: Jobs with `invoiced=true` or `subcontractorPaid=true` are never deleted during regeneration
- Excludes dates listed in `Schedule.excludedDates`
- `@@unique([scheduleId, date])` prevents duplicate jobs

### Billing Logic (`lib/invoice-calculations.ts`)

Two independent variables per schedule:
- `clientPayType`: How the client is billed (FLAT_RATE or PER_CLEAN)
- `subcontractorPayType`: How the cleaner is paid (FLAT_RATE or PER_CLEAN)

All 4 combinations are supported:
| Client Billing | Subcontractor Pay | Example |
|---|---|---|
| FLAT_RATE | PER_CLEAN | Client pays $2000/mo, cleaner paid per visit |
| PER_CLEAN | FLAT_RATE | Client pays per visit, cleaner gets monthly rate |
| FLAT_RATE | FLAT_RATE | Both monthly flat rates |
| PER_CLEAN | PER_CLEAN | Both per-visit rates |

### Invoice PDF Template (`components/invoices/invoice-pdf.tsx`)

Matches the Clean Freaks branded template:
- Blue header with logo + "INVOICE" title
- Bill To + Point of Contact two-column layout
- Blue table header with alternating light-blue rows
- Sub Total / Tax / Total summary
- Zelle payment details (admin@thecleanfreaks.co, Shiloh Pro Cleaning Services DBA)
- Dark navy footer with phone + email

### Assumed Completion Model

Recurring cleans are assumed completed unless explicitly changed (cancelled/rescheduled). The system does **not** require manually marking every recurring clean as completed. Invoicing works on all non-cancelled jobs regardless of status.

## Running

```bash
# Development
npm run dev

# Type check
npx tsc --noEmit

# Production build
npm run build && npm start

# Database studio
npx prisma studio

# Push schema changes
npx prisma db push
```

## Database Management

The database is hosted on **Supabase PostgreSQL**. Schema changes are applied via `prisma db push`.

```bash
# Push schema changes to production
$env:DATABASE_URL="your-connection-string"; npx prisma db push

# View database in browser
npx prisma studio
```

> **Note**: The original app used SQLite. It has been migrated to PostgreSQL on Supabase for production use.

---

Built with ❤️ for reducing admin overhead and streamlining operations

**The Clean Freaks Janitorial Services** — Private Use
#   c l e a n - f r e a k s - a p p 
 
 #   c l e a n - f r e a k s - a p p 
 
 #   c l e a n - f r e a k s - a p p 
 
 #   c l e a n - f r e a k s - a p p 
 
 #   c l e a n - f r e a k s - a p p 
 
 #   c l e a n - f r e a k s - a p p 
 
 