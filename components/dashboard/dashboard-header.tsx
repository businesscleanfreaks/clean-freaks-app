"use client"

import { useState, useEffect } from "react"

function getGreeting(): string {
  const hour = new Date().getHours()
  const day = new Date().getDay()
  
  if (day === 0 || day === 6) return "Happy weekend!"
  if (hour >= 5 && hour < 12) return "Good morning!"
  if (hour >= 12 && hour < 17) return "Good afternoon!"
  if (hour >= 17 && hour < 21) return "Good evening!"
  return "Night owl mode!"
}

function getCurrentDate(): string {
  return new Date().toLocaleDateString('en-US', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  })
}

interface DashboardHeaderProps {
  userName?: string
  jobsToday?: number
}

export function DashboardHeader({ jobsToday }: DashboardHeaderProps) {
  const [greeting, setGreeting] = useState(getGreeting())
  const [dateStr, setDateStr] = useState(getCurrentDate())
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setGreeting(getGreeting())
    setDateStr(getCurrentDate())
    
    const interval = setInterval(() => {
      setGreeting(getGreeting())
    }, 60000)
    
    return () => clearInterval(interval)
  }, [])

  if (!mounted) {
    return (
      <div className="mb-8">
        <div className="h-14 w-96 bg-[var(--cf-skeleton-base)] rounded-lg" />
        <div className="h-5 w-64 bg-[var(--cf-skeleton-base)] rounded mt-3" />
      </div>
    )
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 sm:mb-8 animate-fade-in">
      <div>
        <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
          {greeting}
        </h1>
        {jobsToday !== undefined && (
          <p className="text-sm font-medium mt-1 sm:mt-2 text-cf-text-muted animate-fade-in" style={{ animationDelay: '200ms' }}>
            {jobsToday > 0
              ? `You have ${jobsToday} job${jobsToday !== 1 ? 's' : ''} scheduled today.`
              : 'No jobs scheduled for today.'}
          </p>
        )}
      </div>
      
      <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0 mt-2 sm:mt-0 sm:text-right animate-fade-in" style={{ animationDelay: '100ms' }}>
        <p className="text-xs sm:text-sm font-medium text-foreground">
          {dateStr}
        </p>
      </div>
    </div>
  )
}
