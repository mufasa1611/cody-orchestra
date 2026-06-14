import { InstallationVersion } from "@cody/core/installation/version"

const serviceUrl = () => (process.env["CODY_VERIFICATION_URL"] ?? "https://install.kingkung.men").replace(/\/$/, "")

class VerificationError extends Error {
  override readonly name = "VerificationError"

  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message)
  }
}

async function post(path: string, body?: unknown) {
  const response = await fetch(`${serviceUrl()}${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new VerificationError("Email verification service is temporarily unavailable")
  })
  const value = (await response.json().catch(() => ({}))) as {
    error?: string
    message?: string
    [key: string]: unknown
  }
  if (!response.ok) {
    throw new VerificationError(value.message ?? "Email verification failed", response.status)
  }
  return value
}

export async function createRegistrationChallenge(input: { registrationID: string; username: string; email: string }) {
  const result = await post("/v1/challenges", {
    install_id: input.registrationID,
    purpose: "webui-registration",
    display_name: input.username,
    email: input.email,
    installer_version: InstallationVersion,
    platform: "webui",
  })
  return {
    challengeID: String(result.challenge_id),
    expiresAt: String(result.expires_at),
    resendAfter: String(result.resend_after),
  }
}

export async function resendRegistrationChallenge(challengeID: string) {
  return post(`/v1/challenges/${encodeURIComponent(challengeID)}/resend`)
}

export async function verifyRegistrationChallenge(challengeID: string, code: string) {
  const result = await post(`/v1/challenges/${encodeURIComponent(challengeID)}/verify`, { code })
  return {
    receipt: String(result.receipt),
    expiresAt: String(result.expires_at),
  }
}

export async function validateRegistrationReceipt(input: { registrationID: string; email: string; receipt: string }) {
  const result = await post("/v1/receipts/validate", {
    install_id: input.registrationID,
    purpose: "webui-registration",
    email: input.email,
    receipt: input.receipt,
    installer_version: InstallationVersion,
    platform: "webui",
  })
  return result.valid === true
}

export { VerificationError }
