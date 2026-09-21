/**
 * Where a login is allowed to send you afterwards.
 *
 * The login page read `?redirect=` and handed it straight to `router.push`.
 * Absolute URLs are accepted there, so a link like
 *
 *     /login?redirect=https://not-really-cleanfreaks.example/invoices
 *
 * logs the user in and then lands them on someone else's page, wearing the
 * trust of having just signed in to ours. That is the shape phishing wants:
 * the domain in the address bar changes at the exact moment a person has
 * stopped looking at it.
 *
 * Only a path within this app is allowed. Anything else falls back to the
 * home page, which is never wrong, only occasionally less convenient.
 *
 * Pure: no router, no window.
 */

/** Where to go when the requested destination cannot be trusted. */
export const DEFAULT_REDIRECT = "/"

/**
 * The path to navigate to after signing in.
 *
 * Accepts a site-relative path only. Rejected: absolute URLs of any scheme,
 * protocol-relative `//host` (which a browser reads as another origin),
 * backslash variants that some parsers normalise into `//`, and anything not
 * starting with a single `/`.
 */
export function safeRedirectPath(raw: string | null | undefined): string {
  const value = (raw ?? "").trim()
  if (!value) return DEFAULT_REDIRECT

  // Must be rooted. This alone rejects "https://…", "javascript:…" and
  // "evil.example/path".
  if (!value.startsWith("/")) return DEFAULT_REDIRECT

  // "//host" and "/\host" are read as protocol-relative URLs by browsers, so
  // they leave the site while looking like a path.
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_REDIRECT

  // A control character or newline can split what follows into something else.
  if (/[\u0000-\u001F\u007F]/.test(value)) return DEFAULT_REDIRECT

  return value
}
