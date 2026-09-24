/**
 * The city a location is in, read from its free-text address.
 *
 * Addresses are typed by hand and come in every shape: "…Ave. Gardena, CA
 * 90249" with no comma before the city, "…Blvd, Unit #222, Santa Monica CA
 * 90405" with the unit in its own piece, "…Culver City CA. 90232". The old rule
 * took the second-to-last comma piece, which is the state and zip or the unit
 * as often as the city.
 *
 * So: drop the country, state and zip from the end, take the last comma piece,
 * and if it still has the street in it, keep the words after the last number or
 * street word. An address with no state and a single piece ("Creek View
 * Court") gives nothing rather than a guess.
 */

const STREET_WORDS = new Set([
  "st", "street", "ave", "avenue", "blvd", "boulevard", "rd", "road", "dr", "drive",
  "ln", "lane", "way", "hwy", "highway", "cir", "circle", "ct", "court", "pl", "place",
  "pkwy", "parkway", "ter", "terrace", "sq", "square", "trl", "trail",
  "ste", "suite", "unit", "apt", "fl", "floor", "bldg",
])

const COUNTRY = /[,\s]+(usa|us|united states)\.?\s*$/i
const STATE_ZIP = /[,\s]+(ca|calif|california)\.?\s*(\d{5}(-\d{4})?)?\s*$/i

export function areaFromAddress(address: string | null | undefined): string {
  if (!address) return ""
  let text = address.trim().replace(COUNTRY, "")
  const hadState = STATE_ZIP.test(text)
  text = text.replace(STATE_ZIP, "").replace(/[,\s]+$/, "")

  const pieces = text.split(",").map(p => p.trim()).filter(Boolean)
  if (pieces.length === 0) return ""
  if (!hadState && pieces.length < 2) return ""

  const words = pieces[pieces.length - 1].split(/\s+/)
  let cut = -1
  words.forEach((word, i) => {
    const bare = word.replace(/[.,#]/g, "").toLowerCase()
    if (/\d/.test(word) || word.startsWith("#") || STREET_WORDS.has(bare)) cut = i
  })
  // "Ste K", "Unit B": the letter after a unit word belongs to the unit.
  if (cut >= 0 && /^(ste|suite|unit|apt)$/.test(words[cut].replace(/[.,]/g, "").toLowerCase()) && words[cut + 1]?.length === 1) {
    cut += 1
  }
  return words.slice(cut + 1).join(" ").replace(/[.,]+$/, "").trim()
}

/** A client's area: that of its first location that has one. */
export function firstArea(addresses: (string | null | undefined)[]): string {
  for (const address of addresses) {
    const area = areaFromAddress(address)
    if (area) return area
  }
  return ""
}
