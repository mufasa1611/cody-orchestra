// @ts-nocheck

import { Cody } from "@cody/core"
import { ReadTool } from "@cody/core/tools"

const cody = Cody.make({})

cody.tool.add(ReadTool)

cody.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

cody.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

cody.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await cody.session.create({
  agent: "build",
})

cody.subscribe((event) => {
  console.log(event)
})

await cody.session.prompt({
  sessionID,
  text: "hey what is up",
})

await cody.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await cody.session.wait()

console.log(await cody.session.messages(sessionID))
