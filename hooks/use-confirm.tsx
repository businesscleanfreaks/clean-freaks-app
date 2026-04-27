"use client"

import { useState, useCallback, useMemo, ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface ConfirmOptions {
  title?: string
  description: string | ReactNode
  confirmText?: string
  cancelText?: string
  variant?: "default" | "destructive"
}

export function useConfirm() {
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    options: ConfirmOptions | null
    resolve: ((value: boolean) => void) | null
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  })

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        options,
        resolve,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    setConfirmState((prev) => {
      if (prev.resolve) {
        prev.resolve(true)
      }
      return {
        isOpen: false,
        options: null,
        resolve: null,
      }
    })
  }, [])

  const handleCancel = useCallback(() => {
    setConfirmState((prev) => {
      if (prev.resolve) {
        prev.resolve(false)
      }
      return {
        isOpen: false,
        options: null,
        resolve: null,
      }
    })
  }, [])

  const ConfirmDialog = useMemo(() => {
    return function ConfirmDialogComponent() {
      if (!confirmState.options) return null

      return (
        <AlertDialog open={confirmState.isOpen} onOpenChange={(open) => {
          if (!open) handleCancel()
        }}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmState.options.title || "Confirm Action"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmState.options.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancel}>
                {confirmState.options.cancelText || "Cancel"}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                className={confirmState.options.variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              >
                {confirmState.options.confirmText || "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )
    }
  }, [confirmState, handleConfirm, handleCancel])

  return { confirm, ConfirmDialog }
}

