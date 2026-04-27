"use client"

interface ActionSpinnerProps {
  size?: number
  color?: string
  className?: string
}

export function ActionSpinner({
  size = 18,
  color = "currentColor",
  className,
}: ActionSpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className ?? ""}`}
      style={{ animationDuration: "0.7s" }}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="50 20"
        opacity={0.9}
      />
    </svg>
  )
}
