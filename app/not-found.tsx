import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Home, Search } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
        {/* 404 Number */}
        <div className="mb-6">
          <h1 className="text-8xl font-bold text-teal-600 mb-2">404</h1>
          <div className="w-24 h-1 bg-teal-600 mx-auto rounded-full"></div>
        </div>

        {/* Message */}
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Page Not Found
        </h2>

        <p className="text-gray-600 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-center">
          <Link href="/">
            <Button className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white">
              <Home className="w-4 h-4" />
              Go to Dashboard
            </Button>
          </Link>

          <Link href="/invoices">
            <Button variant="outline" className="flex items-center gap-2">
              <Search className="w-4 h-4" />
              View Invoices
            </Button>
          </Link>
        </div>

        {/* Helpful Links */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-500 mb-3">Quick links:</p>
          <div className="flex flex-wrap gap-2 justify-center">
            <Link href="/clients" className="text-sm text-teal-600 hover:text-teal-700 underline">
              Clients
            </Link>
            <span className="text-gray-300">•</span>
            <Link href="/calendar" className="text-sm text-teal-600 hover:text-teal-700 underline">
              Calendar
            </Link>
            <span className="text-gray-300">•</span>
            <Link href="/subcontractors" className="text-sm text-teal-600 hover:text-teal-700 underline">
              Cleaners
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

