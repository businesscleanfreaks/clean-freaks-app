import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border border-gray-300 bg-white/80 backdrop-blur-sm px-3 py-2 text-sm transition-all duration-300",
          "ring-offset-background placeholder:text-gray-400 placeholder:transition-opacity placeholder:duration-300",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2",
          "focus-visible:border-teal-500 focus-visible:bg-white focus-visible:shadow-md focus-visible:shadow-teal-500/10",
          "hover:border-gray-400 hover:bg-white",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-50",
          "resize-none",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
