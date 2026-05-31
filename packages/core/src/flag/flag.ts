import { Config } from "effect"
import { InstallationChannel } from "../installation/version"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

// Channels that default to the new effect-httpapi server backend. The legacy
// hono backend remains the default for stable (`prod`/`latest`) installs.
const HTTPAPI_DEFAULT_ON_CHANNELS = new Set(["dev", "beta", "local"])

function number(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const CODY_EXPERIMENTAL = truthy("CODY_EXPERIMENTAL")
const CODY_DISABLE_CLAUDE_CODE = truthy("CODY_DISABLE_CLAUDE_CODE")
const CODY_DISABLE_CLAUDE_CODE_SKILLS =
  CODY_DISABLE_CLAUDE_CODE || truthy("CODY_DISABLE_CLAUDE_CODE_SKILLS")
const copy = process.env["CODY_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  CODY_AUTO_SHARE: truthy("CODY_AUTO_SHARE"),
  CODY_AUTO_HEAP_SNAPSHOT: truthy("CODY_AUTO_HEAP_SNAPSHOT"),
  CODY_GIT_BASH_PATH: process.env["CODY_GIT_BASH_PATH"],
  CODY_CONFIG: process.env["CODY_CONFIG"],
  CODY_CONFIG_CONTENT: process.env["CODY_CONFIG_CONTENT"],
  CODY_DISABLE_AUTOUPDATE: truthy("CODY_DISABLE_AUTOUPDATE"),
  CODY_ALWAYS_NOTIFY_UPDATE: truthy("CODY_ALWAYS_NOTIFY_UPDATE"),
  CODY_DISABLE_PRUNE: truthy("CODY_DISABLE_PRUNE"),
  CODY_DISABLE_TERMINAL_TITLE: truthy("CODY_DISABLE_TERMINAL_TITLE"),
  CODY_SHOW_TTFD: truthy("CODY_SHOW_TTFD"),
  CODY_PERMISSION: process.env["CODY_PERMISSION"],
  CODY_DISABLE_DEFAULT_PLUGINS: truthy("CODY_DISABLE_DEFAULT_PLUGINS"),
  CODY_DISABLE_LSP_DOWNLOAD: truthy("CODY_DISABLE_LSP_DOWNLOAD"),
  CODY_ENABLE_EXPERIMENTAL_MODELS: truthy("CODY_ENABLE_EXPERIMENTAL_MODELS"),
  CODY_DISABLE_AUTOCOMPACT: truthy("CODY_DISABLE_AUTOCOMPACT"),
  CODY_DISABLE_MODELS_FETCH: truthy("CODY_DISABLE_MODELS_FETCH"),
  CODY_DISABLE_MOUSE: truthy("CODY_DISABLE_MOUSE"),
  CODY_DISABLE_CLAUDE_CODE,
  CODY_DISABLE_CLAUDE_CODE_PROMPT: CODY_DISABLE_CLAUDE_CODE || truthy("CODY_DISABLE_CLAUDE_CODE_PROMPT"),
  CODY_DISABLE_CLAUDE_CODE_SKILLS,
  CODY_DISABLE_EXTERNAL_SKILLS: truthy("CODY_DISABLE_EXTERNAL_SKILLS"),
  CODY_FAKE_VCS: process.env["CODY_FAKE_VCS"],
  CODY_SERVER_PASSWORD: process.env["CODY_SERVER_PASSWORD"],
  CODY_SERVER_USERNAME: process.env["CODY_SERVER_USERNAME"],
  CODY_ENABLE_QUESTION_TOOL: truthy("CODY_ENABLE_QUESTION_TOOL"),

  // Experimental
  CODY_EXPERIMENTAL,
  CODY_EXPERIMENTAL_FILEWATCHER: Config.boolean("CODY_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CODY_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("CODY_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CODY_EXPERIMENTAL_ICON_DISCOVERY: CODY_EXPERIMENTAL || truthy("CODY_EXPERIMENTAL_ICON_DISCOVERY"),
  CODY_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("CODY_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  CODY_ENABLE_EXA: truthy("CODY_ENABLE_EXA") || CODY_EXPERIMENTAL || truthy("CODY_EXPERIMENTAL_EXA"),
  CODY_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: number("CODY_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  CODY_EXPERIMENTAL_OUTPUT_TOKEN_MAX: number("CODY_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  CODY_EXPERIMENTAL_OXFMT: CODY_EXPERIMENTAL || truthy("CODY_EXPERIMENTAL_OXFMT"),
  CODY_EXPERIMENTAL_LSP_TY: truthy("CODY_EXPERIMENTAL_LSP_TY"),
  CODY_EXPERIMENTAL_LSP_TOOL: CODY_EXPERIMENTAL || truthy("CODY_EXPERIMENTAL_LSP_TOOL"),
  CODY_EXPERIMENTAL_PLAN_MODE: CODY_EXPERIMENTAL || truthy("CODY_EXPERIMENTAL_PLAN_MODE"),
  CODY_EXPERIMENTAL_MARKDOWN: !falsy("CODY_EXPERIMENTAL_MARKDOWN"),
  CODY_ENABLE_PARALLEL: truthy("CODY_ENABLE_PARALLEL") || truthy("CODY_EXPERIMENTAL_PARALLEL"),
  CODY_MODELS_URL: process.env["CODY_MODELS_URL"],
  CODY_MODELS_PATH: process.env["CODY_MODELS_PATH"],
  CODY_DISABLE_EMBEDDED_WEB_UI: truthy("CODY_DISABLE_EMBEDDED_WEB_UI"),
  CODY_DB: process.env["CODY_DB"],
  CODY_DISABLE_CHANNEL_DB: truthy("CODY_DISABLE_CHANNEL_DB"),
  CODY_SKIP_MIGRATIONS: truthy("CODY_SKIP_MIGRATIONS"),
  CODY_STRICT_CONFIG_DEPS: truthy("CODY_STRICT_CONFIG_DEPS"),

  CODY_WORKSPACE_ID: process.env["CODY_WORKSPACE_ID"],
  // Defaults to true on dev/beta/local channels so internal users exercise the
  // new effect-httpapi server backend. Stable (`prod`/`latest`) installs stay
  // on the legacy hono backend until the rollout is complete. An explicit env
  // var ("true"/"1" or "false"/"0") always wins, providing an opt-in for
  // stable users and an escape hatch for dev/beta users.
  CODY_EXPERIMENTAL_HTTPAPI:
    truthy("CODY_EXPERIMENTAL_HTTPAPI") ||
    (!falsy("CODY_EXPERIMENTAL_HTTPAPI") && HTTPAPI_DEFAULT_ON_CHANNELS.has(InstallationChannel)),
  CODY_EXPERIMENTAL_WORKSPACES: CODY_EXPERIMENTAL || truthy("CODY_EXPERIMENTAL_WORKSPACES"),
  CODY_EXPERIMENTAL_EVENT_SYSTEM: CODY_EXPERIMENTAL || truthy("CODY_EXPERIMENTAL_EVENT_SYSTEM"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get CODY_DISABLE_PROJECT_CONFIG() {
    return truthy("CODY_DISABLE_PROJECT_CONFIG")
  },
  get CODY_TUI_CONFIG() {
    return process.env["CODY_TUI_CONFIG"]
  },
  get CODY_CONFIG_DIR() {
    return process.env["CODY_CONFIG_DIR"]
  },
  get CODY_PURE() {
    return truthy("CODY_PURE")
  },
  get CODY_PLUGIN_META_FILE() {
    return process.env["CODY_PLUGIN_META_FILE"]
  },
  get CODY_CLIENT() {
    return process.env["CODY_CLIENT"] ?? "cli"
  },
}
