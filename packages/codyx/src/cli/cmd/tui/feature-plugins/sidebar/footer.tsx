import type { TuiPlugin, TuiPluginApi } from "@cody/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo, Show } from "solid-js"
import { Global } from "@cody/core/global"
import { RGBA } from "@opentui/core"
import { Link } from "@tui/ui/link"
import path from "path"
import os from "os"
import fs from "fs"

const id = "internal:sidebar-footer"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) => item.id !== "cody" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  const cwdPath = createMemo(() => {
    const dir = props.api.state.path.directory || process.cwd()
    const out = dir.replace(Global.Path.home, "~")
    const text = props.api.state.vcs?.branch ? out + ":" + props.api.state.vcs.branch : out
    const list = text.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
    }
  })

  const feedbackUrl = createMemo(() => {
    const candidates = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "codyx-installer", "verification.json") : "",
      path.join(os.homedir(), "Library", "Application Support", "codyx-installer", "verification.json"),
      path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "codyx-installer", "verification.json"),
    ]
    for (const filePath of candidates) {
      if (!filePath) continue
      try {
        const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim()
        if (!raw) continue
        const data = JSON.parse(raw)
        if (data.install_id) return `https://install.kingkung.men/feedback?install_id=${encodeURIComponent(data.install_id)}`
      } catch {
        continue
      }
    }
    return "https://install.kingkung.men/feedback"
  })

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>codyx includes free models so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text>
        <span style={{ fg: theme().textMuted }}>{cwdPath().parent}/</span>
        <span style={{ fg: theme().text }}>{cwdPath().name}</span>
      </text>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span> <b>Cody</b>
        <span style={{ fg: theme().text }}>
          <b>-x.local</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
      <text fg={theme().textMuted}>multi Agent build by <span style={{ fg: RGBA.fromHex("#ff8c00") }}><b>M.Farid</b></span> <span style={{ fg: RGBA.fromHex("#90ee90") }}><b>(Mufasa)</b></span></text>
      <Link href={feedbackUrl()} fg={RGBA.fromHex("#58a6ff")}>Send your feedback — click here</Link>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
