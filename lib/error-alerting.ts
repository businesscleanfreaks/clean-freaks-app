import { getErrorMessage } from "@/lib/logger"

interface AlertOptions {
  details?: Record<string, unknown>
  severity?: "warning" | "error"
}

function truncate(value: string, max = 1800): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function formatDetails(details: Record<string, unknown> | undefined): string {
  if (!details) return ""
  try {
    return truncate(JSON.stringify(details, null, 2), 1200)
  } catch {
    return "[unserializable details]"
  }
}

export async function alertOperationalIssue(
  context: string,
  error: unknown,
  options: AlertOptions = {},
): Promise<void> {
  const webhookUrl = process.env.ERROR_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl || process.env.NODE_ENV === "test") return

  const severity = options.severity || "error"
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL || "unknown app"
  const message = getErrorMessage(error)
  const details = formatDetails(options.details)
  const text = [
    `Clean Freaks ${severity}: ${context}`,
    `App: ${appUrl}`,
    `Error: ${truncate(message, 500)}`,
    details ? `Details:\n${details}` : "",
  ].filter(Boolean).join("\n")

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    })
  } catch (alertError) {
    console.error("[alerting] Failed to send operational alert:", getErrorMessage(alertError))
  }
}
