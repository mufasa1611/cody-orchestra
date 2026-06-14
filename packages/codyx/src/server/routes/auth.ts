import { Hono } from "hono"
import type { Context } from "hono"
import * as Auth from "@/server/auth/service"
import * as Jwt from "@/server/auth/jwt"
import { rateLimit } from "@/server/auth/rate-limit"
import { userWorkspaceRoot } from "@/server/auth/user-workspace"
import { serverAuthRequired, serverMode } from "@/server/auth/mode"
import {
  createRegistrationChallenge,
  resendRegistrationChallenge,
  validateRegistrationReceipt,
  VerificationError,
  verifyRegistrationChallenge,
} from "@/server/auth/verification"

const authRoutes = new Hono()

authRoutes.use("/login", rateLimit(10, 60_000))
authRoutes.use("/register", rateLimit(5, 60_000))
authRoutes.use("/register/*", rateLimit(5, 60_000))

function setupAvailable() {
  return serverAuthRequired() && Auth.userCount() === 0
}

function verificationFailure(c: Context, error: unknown) {
  if (error instanceof VerificationError) {
    const status = error.status === 400 || error.status === 409 || error.status === 429 ? error.status : 503
    return c.json({ error: error.message }, status)
  }
  return c.json({ error: "Email verification failed" }, 503)
}

// GET /api/auth/status - public auth mode for the web client boot gate
authRoutes.get("/status", async (c) => {
  const setupRequired = setupAvailable()
  return c.json({
    mode: serverMode(),
    accountAuthRequired: serverAuthRequired(),
    setupRequired,
    registrationMode: setupRequired ? "bootstrap" : "closed",
    privacyUrl: "https://install.kingkung.men/privacy",
  })
})

authRoutes.post("/register/challenge", async (c) => {
  if (!setupAvailable()) return c.json({ error: "Registration is closed" }, 403)
  try {
    const body = (await c.req.json()) as { registration_id?: unknown; username?: unknown; email?: unknown }
    if (
      typeof body.registration_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.registration_id)
    ) {
      return c.json({ error: "A valid registration ID is required" }, 400)
    }
    if (typeof body.username !== "string" || body.username.trim().length < 2) {
      return c.json({ error: "Username must be at least 2 characters" }, 400)
    }
    if (typeof body.email !== "string") return c.json({ error: "A valid email address is required" }, 400)
    return c.json(
      await createRegistrationChallenge({
        registrationID: body.registration_id,
        username: body.username.trim(),
        email: body.email,
      }),
      201,
    )
  } catch (err) {
    return verificationFailure(c, err)
  }
})

authRoutes.post("/register/challenges/:challengeID/resend", async (c) => {
  if (!setupAvailable()) return c.json({ error: "Registration is closed" }, 403)
  try {
    return c.json(await resendRegistrationChallenge(c.req.param("challengeID")))
  } catch (err) {
    return verificationFailure(c, err)
  }
})

authRoutes.post("/register/verify", async (c) => {
  if (!setupAvailable()) return c.json({ error: "Registration is closed" }, 403)
  try {
    const body = (await c.req.json()) as { challenge_id?: unknown; code?: unknown }
    if (typeof body.challenge_id !== "string" || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
      return c.json({ error: "Challenge ID and six-digit code are required" }, 400)
    }
    return c.json(await verifyRegistrationChallenge(body.challenge_id, body.code))
  } catch (err) {
    return verificationFailure(c, err)
  }
})

// POST /api/auth/register — create the first remote-server administrator.
authRoutes.post("/register", async (c) => {
  if (!setupAvailable()) return c.json({ error: "Registration is closed" }, 403)
  try {
    const body = (await c.req.json()) as {
      username?: unknown
      email?: unknown
      password?: unknown
      registration_id?: unknown
      receipt?: unknown
    }
    if (
      typeof body.username !== "string" ||
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      typeof body.registration_id !== "string" ||
      typeof body.receipt !== "string"
    ) {
      return c.json({ error: "Verified registration details are required" }, 400)
    }
    if (
      !(await validateRegistrationReceipt({
        registrationID: body.registration_id,
        email: body.email,
        receipt: body.receipt,
      }))
    ) {
      return c.json({ error: "Email verification receipt is invalid or expired" }, 401)
    }
    const user = Auth.createVerifiedAdmin(body.username, body.email, body.password)
    userWorkspaceRoot(user.id)
    const token = Jwt.sign({ sub: user.id, username: user.username })
    return c.json({ token, user })
  } catch (err) {
    if (err instanceof Auth.ValidationError) return c.json({ error: err.message }, 400)
    return verificationFailure(c, err)
  }
})

// POST /api/auth/login — authenticate and return JWT
authRoutes.post("/login", async (c) => {
  try {
    const body = await c.req.json()
    const { username, password } = body
    if (!username || !password) {
      return c.json({ error: "Username and password required" }, 400)
    }
    const user = Auth.verifyCredentials(username, password)
    userWorkspaceRoot(user.id)
    const token = Jwt.sign({ sub: user.id, username: user.username })
    return c.json({ token, user })
  } catch (err) {
    if (err instanceof Auth.AuthError || err instanceof Auth.ValidationError) {
      return c.json({ error: err.message }, 401)
    }
    return c.json({ error: "Login failed" }, 500)
  }
})

// POST /api/auth/change-password — requires JWT
authRoutes.post("/change-password", async (c) => {
  try {
    const authHeader = c.req.header("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authentication required" }, 401)
    }
    const payload = Jwt.verify(authHeader.slice(7))
    const body = await c.req.json()
    const { current_password, new_password } = body
    if (!current_password || !new_password) {
      return c.json({ error: "current_password and new_password required" }, 400)
    }
    Auth.changePassword(payload.sub, current_password, new_password)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Auth.ValidationError) return c.json({ error: err.message }, 400)
    if (err instanceof Auth.AuthError || err instanceof Jwt.JwtError)
      return c.json({ error: "Authentication failed" }, 401)
    return c.json({ error: "Failed to change password" }, 500)
  }
})

// POST /api/auth/logout — invalidates current JWT
authRoutes.post("/logout", async (c) => {
  const authHeader = c.req.header("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Authentication required" }, 401)
  }
  const token = authHeader.slice(7)
  Jwt.blacklistToken(token)
  return c.json({ success: true })
})

// GET /api/auth/me — returns current user from JWT
authRoutes.get("/me", async (c) => {
  try {
    const authHeader = c.req.header("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authentication required" }, 401)
    }
    const payload = Jwt.verify(authHeader.slice(7))
    const user = Auth.getUser(payload.sub)
    if (!user) return c.json({ error: "User not found" }, 404)
    return c.json({ user })
  } catch (err) {
    if (err instanceof Auth.AuthError || err instanceof Jwt.JwtError)
      return c.json({ error: "Authentication failed" }, 401)
    return c.json({ error: "Failed to get user" }, 500)
  }
})

export default authRoutes
