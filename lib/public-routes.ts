/**
 * Which requests may skip the staff session check.
 *
 * Kept out of `middleware.ts` and tested, because a path rule that is slightly
 * too broad opens every invoice API to the internet and nothing about the app
 * would look different afterwards.
 */

/**
 * The client's own invoice PDF.
 *
 * `/view-invoice/<token>` was already public, but the download button on that
 * page points at this API route, which was not · so a client clicking
 * "Download PDF" was redirected to our staff login instead of their invoice.
 *
 * Narrow on purpose:
 *  - GET only. Generating a PDF (POST) stays behind the session.
 *  - A `token` parameter must be present. Without one this is a staff request
 *    and should go to the login page as before.
 *  - One invoice id segment, so it cannot match any other invoice endpoint.
 *
 * Presence of a token is not the authorisation. The route itself verifies the
 * signature and that the token names THAT invoice; this only decides whether
 * the request is allowed to reach it.
 */
const INVOICE_PDF_PATH = /^\/api\/invoices\/[^/]+\/generate-pdf$/

export interface PublicRouteRequest {
  method: string
  pathname: string
  hasToken: boolean
}

export function isPublicInvoicePdfRequest(request: PublicRouteRequest): boolean {
  if (request.method.toUpperCase() !== "GET") return false
  if (!request.hasToken) return false
  return INVOICE_PDF_PATH.test(request.pathname)
}
