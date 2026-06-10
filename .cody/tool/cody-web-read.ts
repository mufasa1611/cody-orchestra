/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"
import { readResponseText, stripHtml, titleFromHtml, truncate } from "./cody-web-util"

const MAX_BYTES = 2 * 1024 * 1024

export default tool({
  description:
    "Fetch and read a web page from an http or https URL, returning cleaned text with status, content type, title, and source URL.",
  args: {
    url: tool.schema.string().url().describe("HTTP or HTTPS URL to read"),
    format: tool.schema.enum(["text", "html"]).optional().describe("Return cleaned text or raw HTML, default text"),
    timeoutSeconds: tool.schema.number().int().min(1).max(45).optional().describe("Maximum request time, default 20"),
  },
  async execute(args) {
    const url = new URL(args.url)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Only http and https URLs are supported."
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), (args.timeoutSeconds ?? 20) * 1000)

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          Accept: "text/html,text/plain,application/xhtml+xml,application/json;q=0.8,*/*;q=0.2",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
      })
      const contentType = response.headers.get("content-type") ?? "(unknown)"
      const raw = await readResponseText(response, MAX_BYTES)
      const title = contentType.includes("html") ? titleFromHtml(raw) : undefined
      const body = args.format === "html" ? raw : contentType.includes("html") ? stripHtml(raw) : raw.trim()

      return [
        `Profile: Web page read`,
        `URL: ${url.toString()}`,
        `HTTP status: ${response.status} ${response.statusText}`,
        `Content-Type: ${contentType}`,
        title ? `Title: ${title}` : undefined,
        "",
        truncate(body || "(empty)"),
      ]
        .filter(Boolean)
        .join("\n")
    } catch (error) {
      return [`Profile: Web page read`, `URL: ${url.toString()}`, "", `Fetch failed: ${error}`].join("\n")
    } finally {
      clearTimeout(timer)
    }
  },
})
