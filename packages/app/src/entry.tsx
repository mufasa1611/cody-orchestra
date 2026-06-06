// @refresh reload

import * as Sentry from "@sentry/solid"
import { createSignal, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { type Platform, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { handleNotificationClick } from "@/utils/notification-click"
import LoginPage, { clearToken, getStoredToken, storeToken } from "@/pages/login"
import { authFromToken } from "@/utils/server"
import pkg from "../package.json"
import { ServerConnection } from "./context/server"

const DEFAULT_SERVER_URL_KEY = "cody.settings.dat:defaultServerUrl"

const getLocale = () => {
  if (typeof navigator !== "object") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }
  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()
  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

const notify: Platform["notify"] = async (title, description, href) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return

  const notification = new Notification(title, {
    body: description ?? "",
    icon: "/favicon-96x96-v3.png",
  })

  notification.onclick = () => {
    handleNotificationClick(href)
    notification.close()
  }
}

const openLink: Platform["openLink"] = (url) => {
  window.open(url, "_blank")
}

const back: Platform["back"] = () => {
  window.history.back()
}

const forward: Platform["forward"] = () => {
  window.history.forward()
}

const restart: Platform["restart"] = async () => {
  window.location.reload()
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const getCurrentUrl = () => {
  if (location.hostname.includes("cody.ai")) return "http://localhost:4096"
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_CODY_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_CODY_SERVER_PORT ?? "4096"}`
  return location.origin
}

const getDefaultUrl = () => {
  const lsDefault = readDefaultServerUrl()
  if (lsDefault) return lsDefault
  return getCurrentUrl()
}

const clearAuthToken = () => {
  const params = new URLSearchParams(location.search)
  if (!params.has("auth_token")) return
  params.delete("auth_token")
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash)
}

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  openLink,
  back,
  forward,
  restart,
  notify,
  getDefaultServer: async () => {
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: writeDefaultServerUrl,
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `web@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "web",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" && !(import.meta.env.CODY_CHANNEL === "prod" && i.name === "GlobalHandlers"),
      )
    },
  })
}

function WebRoot() {
  const [authed, setAuthed] = createSignal(false)
  const [server, setServer] = createSignal<ServerConnection.Http | null>(null)
  const [ready, setReady] = createSignal(false)

  const validateToken = async (token: string) => {
    const res = await fetch(getCurrentUrl() + "/api/auth/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null)
    return res?.status === 200
  }

  const accountAuthRequired = async () => {
    const res = await fetch(getCurrentUrl() + "/api/auth/status", { method: "GET" }).catch(() => null)
    if (!res?.ok) return true
    const data = (await res.json().catch(() => null)) as { accountAuthRequired?: unknown } | null
    return data?.accountAuthRequired === true
  }

  const buildServer = (token?: string, creds?: { username: string; password: string }): ServerConnection.Http => ({
    type: "http",
    authToken: !!token || !!creds,
    http: {
      url: getCurrentUrl(),
      token,
      ...creds,
    },
  })

  const onLogin = (token: string) => {
    storeToken(token)
    setServer(buildServer(token))
    setAuthed(true)
  }

  onMount(() => {
    const storedToken = getStoredToken()
    const auth = authFromToken(new URLSearchParams(location.search).get("auth_token"))
    clearAuthToken()

    if (auth) {
      setServer(buildServer(undefined, auth))
      setAuthed(true)
      setReady(true)
      return
    }

    if (storedToken) {
      validateToken(storedToken)
        .then((valid) => {
          if (valid) {
            setServer(buildServer(storedToken))
            setAuthed(true)
            return
          }
          clearToken()
          setServer(buildServer())
          setAuthed(false)
        })
        .catch(() => {
          clearToken()
          setServer(buildServer())
          setAuthed(false)
        })
        .finally(() => {
          setReady(true)
        })
      return
    }

    accountAuthRequired()
      .then((required) => {
        setServer(buildServer())
        setAuthed(!required)
        setReady(true)
      })
      .catch(() => {
        setServer(buildServer())
        setAuthed(false)
        setReady(true)
      })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <Show when={ready() ? server() : null} keyed>
          {(currentServer) => (
            <Show when={authed()} fallback={<LoginPage onLogin={onLogin} />}>
              <AppInterface
                defaultServer={ServerConnection.Key.make(currentServer.http.url)}
                servers={[currentServer]}
                disableHealthCheck
              />
            </Show>
          )}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}

if (root instanceof HTMLElement) {
  render(() => <WebRoot />, root)
}
