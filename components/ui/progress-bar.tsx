"use client"

import { cn } from "@/lib/utils"

interface ProgressBarProps {
  value: number // 0-100
  max?: number
  className?: string
  showLabel?: boolean
  label?: string
}

export function ProgressBar({ 
  value, 
  max = 100, 
  className,
  showLabel = false,
  label 
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div className={cn("w-full", className)}>
      {showLabel && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">
            {label || `${Math.round(percentage)}%`}
          </span>
          <span className="text-sm text-gray-500">
            {Math.round(percentage)}%
          </span>
        </div>
      )}
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-teal-500 to-teal-600 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

interface ProgressStepsProps {
  steps: string[]
  currentStep: number
  className?: string
}

export function ProgressSteps({ steps, currentStep, className }: ProgressStepsProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between mb-4">
        {steps.map((step, index) => {
          const isActive = index === currentStep
          const isCompleted = index < currentStep
          
          return (
            <div key={index} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all",
                    isCompleted
                      ? "bg-teal-600 text-white"
                      : isActive
                      ? "bg-teal-100 text-teal-700 ring-2 ring-teal-500"
                      : "bg-gray-200 text-gray-500"
                  )}
                >
                  {isCompleted ? "✓" : index + 1}
                </div>
                <span
                  className={cn(
                    "mt-2 text-xs text-center max-w-[100px]",
                    isActive ? "text-teal-700 font-medium" : "text-gray-500"
                  )}
                >
                  {step}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "h-0.5 flex-1 mx-2 transition-all",
                    isCompleted ? "bg-teal-600" : "bg-gray-200"
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}


