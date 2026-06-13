import type { ReceiptPayload } from "./types"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ])
}

export async function keyedHash(secret: string, value: string) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(value))
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function timingSafeEqual(secret: string, left: string, right: string) {
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(left))
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(right))
}

export function generateCode() {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return String(values[0] % 1_000_000).padStart(6, "0")
}

export async function signReceipt(secret: string, payload: ReceiptPayload) {
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)))
  return `${encoded}.${await keyedHash(secret, encoded)}`
}

export async function verifyReceipt(secret: string, token: string): Promise<ReceiptPayload | undefined> {
  const [encoded, signature, extra] = token.split(".")
  if (!encoded || !signature || extra) return
  if (!(await timingSafeEqual(secret, await keyedHash(secret, encoded), signature))) return
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(base64UrlToBytes(encoded)))
  } catch {
    return
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("install_id" in value) ||
    !("receipt_id" in value) ||
    !("issued_at" in value) ||
    !("expires_at" in value) ||
    typeof value.install_id !== "string" ||
    typeof value.receipt_id !== "string" ||
    typeof value.issued_at !== "number" ||
    typeof value.expires_at !== "number"
  )
    return
  return {
    install_id: value.install_id,
    receipt_id: value.receipt_id,
    issued_at: value.issued_at,
    expires_at: value.expires_at,
  }
}
