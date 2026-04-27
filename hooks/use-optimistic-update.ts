import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Hook for optimistic updates that avoids full page refreshes
 * Updates UI immediately, then refreshes data in background
 */
export function useOptimisticUpdate() {
  const router = useRouter()

  const updateWithRefresh = useCallback(
    async (
      updateFn: () => Promise<Response>,
      onSuccess?: () => void,
      onError?: (error: Error) => void
    ) => {
      try {
        const response = await updateFn()
        
        if (!response.ok) {
          throw new Error('Update failed')
        }

        // Call success callback immediately (optimistic)
        if (onSuccess) {
          onSuccess()
        }

        // Refresh data in background without full page reload
        // Use router.refresh() which is lighter than window.location.reload()
        router.refresh()
      } catch (error) {
        if (onError) {
          onError(error instanceof Error ? error : new Error('Unknown error'))
        }
        throw error
      }
    },
    [router]
  )

  return { updateWithRefresh }
}


