export function truncate(text: string, max = 12000) {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`
}

export function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

export function stripHtml(input: string) {
  return decodeHtml(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim()
}

export function titleFromHtml(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? stripHtml(match[1]) : undefined
}

export async function readResponseText(response: Response, maxBytes: number) {
  const reader = response.body?.getReader()
  if (!reader) return ""

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      const remaining = maxBytes - (total - value.byteLength)
      if (remaining > 0) chunks.push(value.slice(0, remaining))
      break
    }
    chunks.push(value)
  }

  return new TextDecoder().decode(Buffer.concat(chunks))
}
