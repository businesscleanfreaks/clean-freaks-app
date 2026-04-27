type CompactNameOptions = {
  maxWords?: number
  maxChars?: number
}

export function getCompactClientName(
  name: string,
  { maxWords = 2, maxChars = 22 }: CompactNameOptions = {}
): string {
  const cleaned = name.replace(/\s+/g, " ").trim()
  if (!cleaned) return ""

  const words = cleaned.split(" ")
  if (words.length <= maxWords && cleaned.length <= maxChars) {
    return cleaned
  }

  const startsWithThe = words[0]?.toLowerCase() === "the"
  const preferredWordCount = startsWithThe ? Math.min(words.length, maxWords + 1) : Math.min(words.length, maxWords)

  let compact = words.slice(0, preferredWordCount).join(" ")

  if (compact.length <= maxChars) {
    return compact
  }

  if (startsWithThe && words.length > 1) {
    compact = words.slice(1, Math.min(words.length, maxWords + 1)).join(" ")
    if (compact.length <= maxChars) {
      return compact
    }
  }

  compact = words.slice(0, Math.min(words.length, 2)).join(" ")
  if (compact.length <= maxChars) {
    return compact
  }

  return compact
}
