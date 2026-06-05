import { createSignal, Show } from "solid-js"
import { Splash } from "@cody/ui/logo"
import { Button } from "@cody/ui/button"

const JWT_STORAGE_KEY = "cody.auth.jwt"

export function getStoredToken(): string | null {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(JWT_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(JWT_STORAGE_KEY, token)
  } catch { }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(JWT_STORAGE_KEY)
  } catch { }
}

function getServerUrl(): string {
  if (typeof location === "undefined") return "http://localhost:4096"
  if (location.hostname.includes("cody.ai")) return "http://localhost:4096"
  if (import.meta.env.DEV) {
    return "http://" + (import.meta.env.VITE_CODY_SERVER_HOST ?? "localhost") + ":" + (import.meta.env.VITE_CODY_SERVER_PORT ?? "4096")
  }
  return location.origin
}

export default function Login(props: { onLogin?: (token: string) => void }) {
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [isRegister, setRegister] = createSignal(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const endpoint = isRegister() ? "/api/auth/register" : "/api/auth/login"
      const res = await fetch(getServerUrl() + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username(), password: password() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }))
        setError(data.error ?? "Request failed")
        return
      }
      const data = await res.json()
      storeToken(data.token)
      props.onLogin?.(data.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-8 p-6">
      <div class="flex flex-col items-center gap-2">
        <img
          src="/mufasa.jpg"
          alt="Mufasa"
          class="max-w-52 max-h-36 w-auto h-auto object-contain rounded-md border border-border-weak-base"
        />
        <Splash class="w-12 h-15" />
        <h1 class="text-18-medium text-text-strong mt-2">cody_orchestra</h1>
        <p class="text-14-regular text-text-weak">
          multi agent programed by <span style="color: orange">M. Farid</span> (<span style="color: lightgreen">Mufasa</span>)
        </p>
      </div>
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 w-full max-w-sm">
        {error() && (
          <div class="text-14-regular text-text-critical-base bg-surface-critical-base rounded-lg px-3 py-2">{error()}</div>
        )}
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong" for="username">Username</label>
          <input id="username" type="text" value={username()} onInput={(e) => setUsername(e.currentTarget.value)}
            class="px-3 py-2 rounded-lg bg-surface-base border border-border-weak-base text-14-regular text-text-strong placeholder-text-weak outline-none focus:border-border-strong-base transition-colors"
            placeholder="Username" disabled={loading()} autocomplete="username" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong" for="password">Password</label>
          <input id="password" type="password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)}
            class="px-3 py-2 rounded-lg bg-surface-base border border-border-weak-base text-14-regular text-text-strong placeholder-text-weak outline-none focus:border-border-strong-base transition-colors"
            placeholder="Password" disabled={loading()} autocomplete={isRegister() ? "new-password" : "current-password"} />
        </div>
        <Button type="submit" size="large" class="w-full" disabled={loading() || !username() || !password()}>
          {loading() ? (isRegister() ? "Creating account..." : "Signing in...") : (isRegister() ? "Create account" : "Sign in")}
        </Button>
      </form>
      <button
        onClick={() => { setRegister(!isRegister()); setError(null) }}
        class="text-14-regular text-text-weak hover:text-text-strong transition-colors underline cursor-pointer bg-transparent border-none"
      >
        {isRegister() ? "Already have an account? Sign in" : "Don't have an account? Create one"}
      </button>
    </div>
  )
}
