/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

export default tool({
  description:
    "Format newline-delimited source notes into markdown citations. Each input line should be title ; url ; optional note, or title | url | optional note.",
  args: {
    sourcesText: tool.schema
      .string()
      .min(1)
      .describe("Newline-delimited sources, each as: title ; url ; optional note"),
  },
  async execute(args) {
    const lines = args.sourcesText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const citations = lines.map((line, index) => {
      const separator = line.includes("|") ? "|" : ";"
      const [title, url, note] = line.split(separator).map((part) => part.trim())
      if (!title || !url) return `[${index + 1}] ${line}`
      return `[${index + 1}] [${title}](${url})${note ? ` - ${note}` : ""}`
    })

    return ["Profile: Citation formatter", "", citations.join("\n")].join("\n")
  },
})
