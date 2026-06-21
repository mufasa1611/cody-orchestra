/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"
import { decodeHtml, stripHtml, truncate } from "./cody-web-util"

function bingUrl(query: string) {
  const url = new URL("https://www.bing.com/search")
  url.searchParams.set("q", query)
  return url
}

function decodeBingRedirect(raw: string) {
  try {
    const url = new URL(raw)
    const encoded = url.searchParams.get("u")
    if (!encoded) return raw

    const payload = encoded.startsWith("a1") ? encoded.slice(2) : encoded
    const decoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    return decoded.startsWith("http://") || decoded.startsWith("https://") ? decoded : raw
  } catch {
    return raw
  }
}

function extractResults(html: string, limit: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) ?? []

  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!link) continue

    const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    const rawUrl = decodeHtml(link[1])
    results.push({
      title: stripHtml(link[2]),
      url: decodeBingRedirect(rawUrl),
      snippet: snippet ? stripHtml(snippet[1]) : "",
    })
    if (results.length >= limit) break
  }

  return results
}

export default tool({
  description:
    "Search the web through a fixed Bing HTML search endpoint and return title, URL, and snippet results for source-backed research.",
  args: {
    query: tool.schema.string().min(2).max(300).describe("Search query"),
    limit: tool.schema.number().int().min(1).max(10).optional().describe("Maximum result count, default 5"),
    timeoutSeconds: tool.schema.number().int().min(1).max(30).optional().describe("Maximum request time, default 15"),
  },
  async execute(args) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), (args.timeoutSeconds ?? 15) * 1000)

    try {
      const response = await fetch(bingUrl(args.query), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
      })
      const html = await response.text()
      const results = extractResults(html, args.limit ?? 5)
      const body =
        results.length === 0
          ? "No parseable search results found. Try a more specific query or use a direct URL with cody-web-read."
          : results
              .map((result, index) =>
                [`[${index + 1}] ${result.title}`, result.url, result.snippet ? `Snippet: ${result.snippet}` : ""]
                  .filter(Boolean)
                  .join("\n"),
              )
              .join("\n\n")

      return [
        `Profile: Web search`,
        `Provider: Bing HTML`,
        `HTTP status: ${response.status} ${response.statusText}`,
        `Query: ${args.query}`,
        "",
        truncate(body),
      ].join("\n")
    } catch (error) {
      return [`Profile: Web search`, `Provider: Bing HTML`, `Query: ${args.query}`, "", `Search failed: ${error}`].join(
        "\n",
      )
    } finally {
      clearTimeout(timer)
    }
  },
})
