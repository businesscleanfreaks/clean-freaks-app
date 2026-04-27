"use client"

import Link from "next/link"
import { Clock, User, MapPin, CheckCircle, Calendar } from "lucide-react"
import { formatTime } from "@/lib/utils"

interface TodaysJobItem {
  id: string
  clientName: string
  locationName: string
  cleanerName: string | null
  startTime: string | null
  status: string
}

interface TodaysJobsProps {
  jobs: TodaysJobItem[]
  jobsCompleted: number
}

export function TodaysJobs({ jobs, jobsCompleted }: TodaysJobsProps) {
  if (jobs.length === 0) return null

  return (
    <div className="mb-6 animate-slide-left" style={{ animationDelay: '0.1s' }}>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-cf-primary" />
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Today&apos;s Jobs
        </h2>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: jobsCompleted >= jobs.length ? 'rgba(0,168,150,0.15)' : '#F5F5F5',
            color: jobsCompleted >= jobs.length ? '#00A896' : '#888888',
          }}
        >
          {jobsCompleted} of {jobs.length} done
        </span>
      </div>

      <div
        className="rounded-xl border border-cf-border-subtle bg-white overflow-hidden"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
      >
        {jobs.map((job, idx) => {
          const isLast = idx === jobs.length - 1
          const isCompleted = job.status === 'COMPLETED'

          return (
            <Link
              key={job.id}
              href={`/calendar?jobId=${job.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#FAFAFA] active:bg-[#F5F5F5]"
              style={{
                borderBottom: isLast ? 'none' : '1px solid #F3F3F3',
              }}
            >
              {/* Status dot */}
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: isCompleted ? '#00A896' : '#E5E7EB',
                  boxShadow: isCompleted ? '0 0 0 3px rgba(0,168,150,0.12)' : 'none',
                }}
              />

              {/* Client + Location */}
              <div className="flex-1 min-w-0">
                <p
                  className="font-semibold truncate"
                  style={{
                    fontSize: '14px',
                    color: isCompleted ? '#9CA3AF' : '#111111',
                    textDecoration: isCompleted ? 'line-through' : 'none',
                  }}
                >
                  {job.clientName}
                </p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-xs text-gray-500 truncate">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    {job.locationName}
                  </span>
                </div>
              </div>

              {/* Time */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-medium text-gray-500">
                  {job.startTime ? formatTime(job.startTime) : 'TBD'}
                </span>
              </div>

              {/* Cleaner */}
              <div className="flex items-center gap-1 flex-shrink-0 min-w-[80px]">
                <User className="w-3.5 h-3.5 text-gray-400" />
                <span
                  className="text-xs font-medium truncate"
                  style={{ color: job.cleanerName ? '#555555' : '#D97706', maxWidth: '80px' }}
                >
                  {job.cleanerName || 'Unassigned'}
                </span>
              </div>

              {/* Status badge */}
              {isCompleted && (
                <CheckCircle className="w-4 h-4 text-[#00A896] flex-shrink-0" />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
