import { createSignal } from "solid-js"
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
  } catch {}
}

export function clearToken(): void {
  try {
    localStorage.removeItem(JWT_STORAGE_KEY)
  } catch {}
}

export function clearAuthCookies(): void {
  if (typeof document === "undefined") return
  const names = document.cookie
    .split(";")
    .map((cookie) => cookie.split("=", 1)[0]?.trim())
    .filter((name): name is string => !!name && /(?:auth|jwt|token)/i.test(name))

  for (const name of names) {
    document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Lax`
  }
}

function getServerUrl(): string {
  if (typeof location === "undefined") return "http://localhost:4096"
  if (location.hostname.includes("cody.ai")) return "http://localhost:4096"
  if (import.meta.env.DEV) {
    return (
      "http://" +
      (import.meta.env.VITE_CODY_SERVER_HOST ?? "localhost") +
      ":" +
      (import.meta.env.VITE_CODY_SERVER_PORT ?? "4096")
    )
  }
  return location.origin
}

async function responseBody(response: Response) {
  return (await response.json().catch(() => ({ error: "Request failed" }))) as Record<string, string>
}

export default function Login(props: { setupRequired?: boolean; onLogin?: (token: string) => void }) {
  const [username, setUsername] = createSignal("")
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [passwordConfirmation, setPasswordConfirmation] = createSignal("")
  const [code, setCode] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [challengeID, setChallengeID] = createSignal("")
  const [registrationID, setRegistrationID] = createSignal("")
  const [verificationStep, setVerificationStep] = createSignal(false)

  async function login() {
    const response = await fetch(getServerUrl() + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username(), password: password() }),
    })
    const data = await responseBody(response)
    if (!response.ok) {
      setError(data.error ?? "Sign in failed")
      return
    }
    storeToken(data.token)
    props.onLogin?.(data.token)
  }

  async function sendCode() {
    if (password() !== passwordConfirmation()) {
      setError("Passwords do not match")
      return
    }
    if (password().length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    const nextRegistrationID = globalThis.crypto.randomUUID()
    const response = await fetch(getServerUrl() + "/api/auth/register/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registration_id: nextRegistrationID,
        username: username(),
        email: email(),
      }),
    })
    const data = await responseBody(response)
    if (!response.ok) {
      setError(data.error ?? "Could not send the verification code")
      return
    }
    setChallengeID(data.challengeID)
    setRegistrationID(nextRegistrationID)
    setVerificationStep(true)
  }

  async function createOwner() {
    const verified = await fetch(getServerUrl() + "/api/auth/register/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id: challengeID(), code: code() }),
    })
    const verification = await responseBody(verified)
    if (!verified.ok) {
      setError(verification.error ?? "Verification failed")
      return
    }

    const registered = await fetch(getServerUrl() + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username(),
        email: email(),
        password: password(),
        registration_id: registrationID(),
        receipt: verification.receipt,
      }),
    })
    const data = await responseBody(registered)
    if (!registered.ok) {
      setError(data.error ?? "Account creation failed")
      return
    }
    storeToken(data.token)
    props.onLogin?.(data.token)
  }

  async function handleSubmit(event: Event) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (!props.setupRequired) return await login()
      if (!verificationStep()) return await sendCode()
      return await createOwner()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setLoading(false)
    }
  }

  async function resendCode() {
    setError(null)
    setLoading(true)
    try {
      const response = await fetch(
        getServerUrl() + `/api/auth/register/challenges/${encodeURIComponent(challengeID())}/resend`,
        { method: "POST" },
      )
      const data = await responseBody(response)
      if (!response.ok) {
        setError(data.error ?? "Could not resend the code")
        return
      }
      setCode("")
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
        <h1 class="text-18-medium text-text-strong mt-2">
          {props.setupRequired ? "Set up your Codyx server" : "cody_orchestra"}
        </h1>
        <p class="text-14-regular text-text-weak text-center">
          {props.setupRequired
            ? verificationStep()
              ? `Enter the code sent to ${email()}`
              : "Create the first administrator account"
            : "Sign in to your Codyx server"}
        </p>
      </div>

      <form onSubmit={handleSubmit} class="flex flex-col gap-4 w-full max-w-sm">
        {error() && (
          <div class="text-14-regular text-text-critical-base bg-surface-critical-base rounded-lg px-3 py-2">
            {error()}
          </div>
        )}

        {!verificationStep() && (
          <>
            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-strong" for="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username()}
                onInput={(event) => setUsername(event.currentTarget.value)}
                class="px-3 py-2 rounded-lg bg-surface-base border border-border-weak-base text-14-regular text-text-strong placeholder-text-weak outline-none focus:border-border-strong-base transition-colors"
                placeholder="Username"
                disabled={loading()}
                autocomplete="username"
              />
            </div>

            {props.setupRequired && (
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-strong" for="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email()}
                  onInput={(event) => setEmail(event.currentTarget.value)}
                  class="px-3 py-2 rounded-lg bg-surface-base border border-border-weak-base text-14-regular text-text-strong placeholder-text-weak outline-none focus:border-border-strong-base transition-colors"
                  placeholder="you@example.com"
                  disabled={loading()}
                  autocomplete="email"
                />
              </div>
            )}

            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-strong" for="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password()}
                onInput={(event) => setPassword(event.currentTarget.value)}
                class="px-3 py-2 rounded-lg bg-surface-base border border-border-weak-base text-14-regular text-text-strong placeholder-text-weak outline-none focus:border-border-strong-base transition-colors"
                placeholder="Password"
                disabled={loading()}
                autocomplete={props.setupRequired ? "new-password" : "current-password"}
              />
            </div>

            {props.setupRequired && (
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-strong" for="password-confirmation">
                  Confirm password
                </label>
                <input
                  id="password-confirmation"
                  type="password"
                  value={passwordConfirmation()}
                  onInput={(event) => setPasswordConfirmation(event.currentTarget.value)}
                  class="px-3 py-2 rounded-lg bg-surface-base border border-border-weak-base text-14-regular text-text-strong placeholder-text-weak outline-none focus:border-border-strong-base transition-colors"
                  placeholder="Confirm password"
                  disabled={loading()}
                  autocomplete="new-password"
                />
              </div>
            )}
          </>
        )}

        {verificationStep() && (
          <div class="flex flex-col gap-1.5">
            <label class="text-12-medium text-text-strong" for="verification-code">
              Verification code
            </label>
            <input
              id="verification-code"
              inputmode="numeric"
              maxlength="6"
              value={code()}
              onInput={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
              class="px-3 py-2 rounded-lg bg-surface-base border border-border-weak-base text-18-medium tracking-widest text-center text-text-strong outline-none focus:border-border-strong-base transition-colors"
              placeholder="000000"
              disabled={loading()}
              autocomplete="one-time-code"
            />
          </div>
        )}

        <Button
          type="submit"
          size="large"
          class="w-full"
          disabled={
            loading() ||
            !username() ||
            !password() ||
            (props.setupRequired && (!email() || (verificationStep() && code().length !== 6)))
          }
        >
          {loading()
            ? "Please wait..."
            : props.setupRequired
              ? verificationStep()
                ? "Verify and create account"
                : "Send verification code"
              : "Sign in"}
        </Button>

        {verificationStep() && (
          <div class="flex justify-between text-12-regular">
            <button
              type="button"
              onClick={() => void resendCode()}
              disabled={loading()}
              class="text-text-weak hover:text-text-strong underline bg-transparent border-none cursor-pointer"
            >
              Resend code
            </button>
            <button
              type="button"
              onClick={() => {
                setVerificationStep(false)
                setCode("")
                setError(null)
              }}
              disabled={loading()}
              class="text-text-weak hover:text-text-strong underline bg-transparent border-none cursor-pointer"
            >
              Change email
            </button>
          </div>
        )}
      </form>

      {props.setupRequired && (
        <p class="text-12-regular text-text-weak max-w-sm text-center">
          Your email is used for account verification and essential security notices.{" "}
          <a class="underline" href="https://install.kingkung.men/privacy" target="_blank" rel="noreferrer">
            Privacy
          </a>
        </p>
      )}
    </div>
  )
}
