"use client"

import { useEffect, useState } from "react"

interface AnimatedSparklineProps {
  trend?: "up" | "down"
  delay?: number
  className?: string
}

export function AnimatedSparkline({
  trend = "up",
  delay = 0,
  className = "",
}: AnimatedSparklineProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true)
    }, delay)

    return () => clearTimeout(timer)
  }, [delay])

  const path = trend === "up" 
    ? "M0,20 Q5,18 10,15 T20,12 T30,8 T40,10 T50,5"
    : "M0,5 Q5,8 10,10 T20,15 T30,12 T40,18 T50,20"
  
  const color = trend === "up" ? "#10B981" : "#EF4444"

  return (
    <svg 
      className={`w-16 h-6 ${className}`} 
      viewBox="0 0 50 25"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{
          strokeDasharray: 100,
          strokeDashoffset: isVisible ? 0 : 100,
          transition: `stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
        }}
      />
      {/* Glow effect */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.2"
        style={{
          strokeDasharray: 100,
          strokeDashoffset: isVisible ? 0 : 100,
          transition: `stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
          filter: 'blur(2px)',
        }}
      />
    </svg>
  )
}



