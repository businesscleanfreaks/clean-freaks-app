"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { X, Calendar, MapPin, Check, User, Sparkles } from "lucide-react"
import { format } from "date-fns"
import { formatTime } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { refreshCalendarData } from "./calendar-client"

interface Job {
  id: string
  date: string
  startTime?: string
  startWindowBegin?: string
  startWindowEnd?: string
  location: {
    name: string
    client: {
      name: string
    }
  }
  subcontractor?: {
    id: string
    name: string
  }
}

interface Subcontractor {
  id: string
  name: string
}

interface QuickAssignModalProps {
  isOpen: boolean
  onClose: () => void
  unassignedJobs: Job[]
  subcontractors: Subcontractor[]
}

export function QuickAssignModal({ isOpen, onClose, unassignedJobs, subcontractors }: QuickAssignModalProps) {
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [remainingJobs, setRemainingJobs] = useState<Job[]>(unassignedJobs)
  const [bulkWorker, setBulkWorker] = useState<string>('')

  useEffect(() => {
    setRemainingJobs(unassignedJobs)
    setAssignments({})
    setSaved({})
  }, [unassignedJobs])

  const handleAssign = async (jobId: string, subcontractorId: string) => {
    if (!subcontractorId) return

    setAssignments(prev => ({ ...prev, [jobId]: subcontractorId }))
    setSaving(prev => ({ ...prev, [jobId]: true }))

    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subcontractorId }),
      })

      if (response.ok) {
        setSaved(prev => ({ ...prev, [jobId]: true }))
        // Remove from remaining after a brief delay to show the checkmark
        setTimeout(() => {
          setRemainingJobs(prev => prev.filter(j => j.id !== jobId))
        }, 800)
      } else {
        // Show error feedback
        const errorData = await response.json().catch(() => ({}))
        logger.error('Failed to assign worker:', errorData)
        // Reset the assignment so user can try again
        setAssignments(prev => {
          const updated = { ...prev }
          delete updated[jobId]
          return updated
        })
        // You could add a toast notification here
      }
    } catch (error) {
      logger.error('Failed to assign worker:', error)
      // Reset the assignment so user can try again
      setAssignments(prev => {
        const updated = { ...prev }
        delete updated[jobId]
        return updated
      })
    } finally {
      setSaving(prev => ({ ...prev, [jobId]: false }))
    }
  }

  const handleBulkAssign = async () => {
    if (!bulkWorker) return

    for (const job of remainingJobs) {
      if (!saved[job.id]) {
        await handleAssign(job.id, bulkWorker)
      }
    }
  }

  const handleClose = () => {
    refreshCalendarData()
    onClose()
  }

  if (!isOpen) return null

  const allDone = remainingJobs.length === 0

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[150vh] flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <User className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Assign Subcontractors</h2>
              <p className="text-sm text-stone-500">
                {allDone ? 'All done!' : `${remainingJobs.length} job${remainingJobs.length !== 1 ? 's' : ''} need attention`}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors duration-150"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {allDone ? (
            // Success State
            <div className="py-12 text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6 animate-in zoom-in duration-300">
                <Check className="w-10 h-10 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">All jobs have cleaners assigned!</h3>
              <p className="text-stone-500 mb-6">Great job! Your schedule is all set.</p>
              <div className="flex items-center justify-center gap-2 text-emerald-600">
                <Sparkles className="w-5 h-5" />
                <span className="font-medium">You&apos;re on top of it</span>
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
          ) : (
            <>
              {/* Bulk Assign Option */}
              {remainingJobs.length > 1 && (
                <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium text-gray-600">Quick: Assign all to</span>
                    <select
                      value={bulkWorker}
                      onChange={(e) => setBulkWorker(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
                    >
                      <option value="">Choose cleaner...</option>
                      {subcontractors.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!bulkWorker}
                      onClick={handleBulkAssign}
                      className="bg-teal-600 hover:bg-teal-700 text-white"
                    >
                      Apply to All
                    </Button>
                  </div>
                </div>
              )}

              {/* Job List */}
              <div className="space-y-4">
                {remainingJobs.map((job) => {
                  const isSaving = saving[job.id]
                  const isSaved = saved[job.id]
                  const jobDate = new Date(job.date)

                  return (
                    <div
                      key={job.id}
                      className={`p-4 rounded-xl border-2 transition-all duration-300 ${isSaved
                        ? 'bg-emerald-50 border-emerald-300'
                        : 'bg-white border-gray-200 hover:border-stone-300'
                        }`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Date Badge */}
                        <div className="w-14 h-14 rounded-xl bg-stone-100 flex flex-col items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-stone-500 uppercase">
                            {format(jobDate, 'MMM')}
                          </span>
                          <span className="text-xl font-bold text-stone-800">
                            {format(jobDate, 'd')}
                          </span>
                        </div>

                        {/* Job Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm text-stone-500 mb-1">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{format(jobDate, 'EEEE')}</span>
                            <span>•</span>
                            <span>
                              {job.startTime ? formatTime(job.startTime) :
                                job.startWindowBegin ? `${formatTime(job.startWindowBegin)}-${formatTime(job.startWindowEnd || '')}` : 'TBD'}
                            </span>
                          </div>
                          <h4 className="font-bold text-gray-900 truncate">{job.location.client.name}</h4>
                          <p className="text-sm text-stone-500 flex items-center gap-1 truncate">
                            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                            {job.location.name}
                          </p>
                        </div>

                        {/* Worker Selection */}
                        <div className="flex-shrink-0">
                          {isSaved ? (
                            <div className="flex items-center gap-2 text-emerald-600 bg-emerald-100 px-3 py-2 rounded-lg">
                              <Check className="w-4 h-4" />
                              <span className="text-sm font-medium">
                                {subcontractors.find(s => s.id === assignments[job.id])?.name}
                              </span>
                            </div>
                          ) : (
                            <select
                              value={assignments[job.id] || ''}
                              onChange={(e) => handleAssign(job.id, e.target.value)}
                              disabled={isSaving}
                              className={`text-sm border-2 rounded-lg px-3 py-2 min-w-[160px] transition-all ${isSaving
                                ? 'border-teal-300 bg-teal-50 animate-pulse'
                                : 'border-amber-300 bg-amber-50 hover:border-amber-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20'
                                }`}
                            >
                              <option value="">Choose cleaner...</option>
                              {subcontractors.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-sm text-stone-500">
              {allDone
                ? 'Your calendar is ready to go'
                : 'Select a cleaner from the dropdown to assign them'}
            </p>
            <Button
              onClick={handleClose}
              variant={allDone ? 'default' : 'outline'}
              className={allDone ? 'bg-teal-600 hover:bg-teal-700 text-white' : ''}
            >
              {allDone ? 'Done' : 'Close'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

