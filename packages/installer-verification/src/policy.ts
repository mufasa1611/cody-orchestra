export const CODE_TTL_MS = 10 * 60 * 1000
export const RECEIPT_TTL_MS = 365 * 24 * 60 * 60 * 1000
export const RETENTION_MS = 730 * 24 * 60 * 60 * 1000
export const RESEND_DELAY_MS = 60 * 1000
export const SEND_WINDOW_MS = 60 * 60 * 1000
export const MAX_ATTEMPTS = 5
export const MAX_SENDS_PER_WINDOW = 5

export function canResend(lastSentAt: number, now: number) {
  return now - lastSentAt >= RESEND_DELAY_MS
}

export function codeUsable(input: {
  attempts: number
  expiresAt: number
  verifiedAt: number | null
  now: number
}) {
  return input.verifiedAt === null && input.attempts < MAX_ATTEMPTS && input.expiresAt > input.now
}
