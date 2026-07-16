import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onFocus, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-all duration-300",
          "ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "placeholder:text-muted-foreground placeholder:transition-opacity placeholder:duration-300",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2",
          "focus-visible:border-teal-500 focus-visible:shadow-md focus-visible:shadow-teal-500/10",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        onFocus={(event) => {
          if (type === "number" && /^0(?:\.0+)?$/.test(event.currentTarget.value)) {
            event.currentTarget.select()
          }
          onFocus?.(event)
        }}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
