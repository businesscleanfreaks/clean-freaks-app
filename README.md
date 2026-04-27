# The Clean Freaks — Management System

A comprehensive web application for managing commercial cleaning business operations including client scheduling, invoicing, and subcontractor payments.

> **Last Updated:** April 17, 2026

## Features

- **Client Management**: Track clients, multiple locations, billing preferences, and contacts
- **Recurring Scheduling**: Automatic job generation for weekly, bi-weekly, monthly, and custom schedules
- **Calendar View**: Visual week-view job scheduling with drag-and-drop, cleaner color coding, team + client filters
- **Professional Invoicing**: Batch invoicing with PDF generation, custom date ranges, and email delivery
- **Subcontractor Tracking**: Manage payments, job assignments, and team members
- **Dashboard**: Real-time overview of business metrics, today's checklist, overdue invoices
- **Global Search**: ⌘K/Ctrl+K command palette searching clients, cleaners, locations, and invoices

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components, custom design tokens
- **Database**: PostgreSQL (Supabase) with Prisma ORM
- **PDF Generation**: @react-pdf/renderer
- **Date Handling**: date-fns
- **Data Fetching**: SWR for client-side caching and revalidation

## Prerequisites

- Node.js 18+
- npm package manager
- Access to the Supabase PostgreSQL database (connection string in `.env.local`)

## Installation

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
# Ensure .env.local exists with DATABASE_URL and SESSION_SECRET (see Environment section)

# 3. Generate Prisma client
npx prisma generate

# 4. Start development server
npm run dev
```

The app will be available at `http://localhost:3000`.

## Environment Variables

Create or update `.env.local`:

```env
# Database (Supabase PostgreSQL)
DATABASE_URL="postgresql://postgres.xxx:password@aws-1-us-west-1.pooler.supabase.com:5432/postgres"

# Session Secret
SESSION_SECRET="cleanfreaks-production-secret-2026"

# Base URL
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Business Info (for invoices)
NEXT_PUBLIC_APP_NAME="The Clean Freaks Management System"
NEXT_PUBLIC_BUSINESS_NAME="The Clean Freaks Janitorial Services"

# Email (set to true when ready to send real emails)
ENABLE_EMAIL_SENDING=false
```

## Admin Access

- **Email**: `admin@cleanfreaks.com`
- **Password**: `admin123`

## Architecture

### Design Pattern: Custom Hook + Thin Orchestrator

Major components follow a modular pattern where:
- **Custom Hooks** (`use-client-detail.ts`, `use-job-detail.ts`, `use-quick-invoice.ts`) encapsulate all state management, API interactions, and business logic
- **Component Files** act as thin orchestrators, focused purely on rendering
- **Sub-components** handle isolated UI sections

### Project Structure

```
clean-freaks-app/
├── app/
│   ├── api/                     # API routes
│   │   ├── clients/             # Client CRUD + contacts
│   │   ├── locations/           # Location management
│   │   ├── schedules/           # Schedule + job regeneration
│   │   ├── jobs/                # Job management + status updates
│   │   ├── invoices/            # Invoice CRUD + PDF + email
│   │   ├── subcontractors/      # Subcontractor management + payments
│   │   └── search/              # Global cross-entity search
│   ├── clients/                 # Client pages (list, detail, new)
│   ├── calendar/                # Calendar page
│   ├── invoices/                # Invoice pages (list, detail)
│   ├── subcontractors/          # Subcontractor pages (list, detail, new)
│   ├── layout.tsx               # Root layout (fonts, providers)
│   └── page.tsx                 # Dashboard
├── components/
│   ├── ui/                      # shadcn/ui + global-search
│   ├── clients/                 # Client detail, wizard, hooks
│   ├── calendar/                # Calendar view, job detail, filters
│   ├── invoices/                # Invoice modal, PDF template, hooks
│   ├── subcontractors/          # Cleaner detail, payments
│   ├── layout-wrapper.tsx       # Authenticated layout (sidebar, bottom tabs, global search)
│   ├── nav-sidebar.tsx          # Desktop navigation sidebar
│   └── mobile-bottom-tabs.tsx   # Mobile tab navigation
├── lib/
│   ├── db.ts                    # Prisma client singleton
│   ├── auth.ts                  # Session authentication
│   ├── invoice-calculations.ts  # Billing logic (flat-rate + per-clean)
│   ├── regenerate-schedule-jobs.ts  # Scheduling engine
│   ├── calendar-design-tokens.ts    # Cleaner color assignments
│   ├── calendar-filter-context.tsx  # Persistent filter state
│   ├── email-templates.ts       # Invoice email templates
│   └── utils.ts                 # Shared utilities
├── prisma/
│   └── schema.prisma            # PostgreSQL schema (12 models)
├── types/
│   └── index.ts                 # TypeScript interfaces
└── public/
    ├── images/                  # Logo and branding
    └── invoices/                # Generated invoice PDFs
```

## Data Models

| Model | Purpose |
|-------|---------|
| **Client** | Business name, billing type (FLAT_RATE/PER_CLEAN), contacts, active status |
| **Location** | Address, access info, belongs to a client. Multiple locations per client. |
| **Schedule** | Recurring template — frequency, rates, assigned subcontractor. Independent `clientPayType` and `subcontractorPayType`. |
| **Job** | Individual scheduled cleaning. Status: SCHEDULED/COMPLETED/CANCELLED. Tracks invoiced and subcontractorPaid flags. |
| **Invoice** | Invoice number, line items, PDF, payment tracking. Status: DRAFT/SENT/PAID. |
| **InvoiceLineItem** | Per-job or per-schedule line on an invoice |
| **Subcontractor** | Cleaner business name, contact info, team members |
| **SubcontractorPayment** | Payment record with itemized job line items |
| **AddOnService** | Extra services attached to jobs or schedules (own client + subcontractor rates) |
| **ClientContact** | Multiple contacts per client (communication, invoicing, general) |
| **AdminUser** | Authentication for the management dashboard |
| **BillingSettings** | System-wide billing configuration |

## Key Business Logic

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
#   c l e a n - f r e a k s - a p p  
 #   c l e a n - f r e a k s - a p p  
 #   c l e a n - f r e a k s - a p p  
 #   c l e a n - f r e a k s - a p p  
 #   c l e a n - f r e a k s - a p p  
 