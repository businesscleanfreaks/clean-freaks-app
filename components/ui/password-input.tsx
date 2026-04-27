"use client"

import { forwardRef, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

export interface PasswordInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * Drop-in replacement for any password / secret / token input.
 * Renders a correctly-positioned eye toggle inside the input box.
 *
 * Usage:
 *   <PasswordInput value={val} onChange={...} placeholder="sk-ant-..." />
 *
 * The show/hide state is internal — no extra useState needed in the parent.
 */
const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [show, setShow] = useState(false)

    return (
      <div className="relative w-full">
        <input
          ref={ref}
          type={show ? "text" : "password"}
          className={cn(
            // Match shadcn Input styles exactly
            "flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 pr-10 text-sm transition-all duration-300",
            "ring-offset-background placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2",
            "focus-visible:border-teal-500 focus-visible:shadow-md focus-visible:shadow-teal-500/10",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide" : "Show"}
          className="absolute right-0 top-0 bottom-0 w-10 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    )
  }
)
PasswordInput.displayName = "PasswordInput"

export { PasswordInput }
