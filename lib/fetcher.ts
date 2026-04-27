/**
 * Shared SWR fetcher that properly checks response status.
 * Throws on non-OK responses so SWR triggers its error state.
 */
export const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error(`Request failed: ${res.status}`)
    throw error
  }
  return res.json()
}
