"use client"

import { useEffect, useRef, useState } from "react"
import { formatCurrency } from "@/lib/utils"

interface AnimatedNumberProps {
  value: number
  duration?: number
  isCurrency?: boolean
  className?: string
  delay?: number
}

export function AnimatedNumber({
  value,
  duration = 1500,
  isCurrency = false,
  className = "",
  delay = 0,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const [hasStarted, setHasStarted] = useState(false)
  const elementRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    // Delay start
    const delayTimer = setTimeout(() => {
      setHasStarted(true)
    }, delay)

    return () => clearTimeout(delayTimer)
  }, [delay])

  useEffect(() => {
    if (!hasStarted) return

    const startTime = Date.now()
    const startValue = 0
    const endValue = value

    const easeOutQuart = (t: number): number => {
      return 1 - Math.pow(1 - t, 4)
    }

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutQuart(progress)
      
      const currentValue = startValue + (endValue - startValue) * easedProgress
      setDisplayValue(currentValue)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [value, duration, hasStarted])

  const formattedValue = isCurrency 
    ? formatCurrency(Math.round(displayValue))
    : Math.round(displayValue).toLocaleString()

  return (
    <span 
      ref={elementRef}
      className={`number-animated ${className}`}
    >
      {formattedValue}
    </span>
  )
}



