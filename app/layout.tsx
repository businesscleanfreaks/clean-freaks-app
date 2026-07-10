import type { Metadata, Viewport } from "next"
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { ErrorBoundary } from "@/components/error-boundary"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LayoutWrapper } from "@/components/layout-wrapper"

const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ui",
  display: "swap",
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export const metadata: Metadata = {
  title: "Clean Freaks",
  description: "Commercial cleaning business management",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${hankenGrotesk.variable} ${ibmPlexMono.variable}`}>
      <head>
        <meta name="theme-color" content="#f3f0e9" />
      </head>
      <body className="font-sans">
        <TooltipProvider delayDuration={300}>
          <LayoutWrapper>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </LayoutWrapper>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  )
}
