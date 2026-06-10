/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"
import { truncate } from "./cody-web-util"

function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 30)
}

export default tool({
  description:
    "Create a compact source note from provided source text. This is deterministic extraction, not an LLM factual judgment.",
  args: {
    title: tool.schema.string().optional().describe("Source title"),
    url: tool.schema.string().url().optional().describe("Source URL"),
    text: tool.schema.string().min(1).describe("Source text to summarize"),
    maxSentences: tool.schema.number().int().min(1).max(8).optional().describe("Maximum extracted sentences, default 4"),
  },
  async execute(args) {
    const picked = sentences(args.text).slice(0, args.maxSentences ?? 4)
    return truncate(
      [
        "Profile: Source summary helper",
        args.title ? `Title: ${args.title}` : undefined,
        args.url ? `URL: ${args.url}` : undefined,
        "",
        picked.length ? picked.map((sentence) => `- ${sentence}`).join("\n") : "- No clear sentence candidates found.",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  },
})
