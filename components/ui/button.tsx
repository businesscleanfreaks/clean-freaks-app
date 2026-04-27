import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 relative overflow-hidden group",
  {
    variants: {
      variant: {
        default: "bg-gradient-to-r from-teal-600 via-teal-500 to-teal-600 text-white shadow-md hover:shadow-lg hover:shadow-teal-500/30 hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0",
        destructive:
          "bg-gradient-to-r from-red-600 via-red-500 to-red-600 text-white shadow-md hover:shadow-lg hover:shadow-red-500/30 hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0",
        outline:
          "border-2 border-gray-300 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-teal-500 hover:text-teal-700 shadow-sm hover:shadow-md hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0",
        secondary:
          "bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 text-gray-900 border border-gray-200 hover:from-gray-200 hover:via-gray-100 hover:to-gray-200 shadow-sm hover:shadow-md hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0",
        ghost: "hover:bg-gray-100/80 hover:text-gray-900 hover:scale-[1.02] active:scale-[0.98]",
        link: "text-teal-600 underline-offset-4 hover:underline hover:text-teal-700 font-medium",
        premium: "bg-gradient-to-br from-teal-600 via-teal-500 to-blue-600 text-white shadow-lg hover:shadow-xl hover:shadow-teal-500/40 hover:scale-[1.03] hover:-translate-y-1 active:scale-[0.97] active:translate-y-0 before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent before:translate-x-[-100%] hover:before:translate-x-[100%] before:transition-transform before:duration-700",
      },
      size: {
        default: "h-11 px-5 py-2",
        sm: "h-11 px-3 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
