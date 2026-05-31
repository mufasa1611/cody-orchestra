import { Hono } from "hono"
import * as Auth from "@/server/auth/service"
import * as Jwt from "@/server/auth/jwt"

const authRoutes = new Hono()

// POST /api/auth/login — authenticate and return JWT
authRoutes.post("/login", async (c) => {
  try {
    const body = await c.req.json()
    const { username, password } = body
    if (!username || !password) {
      return c.json({ error: "Username and password required" }, 400)
    }
    const user = Auth.verifyCredentials(username, password)
    const token = Jwt.sign({ sub: user.id, username: user.username })
    return c.json({ token, user: { id: user.id, username: user.username, created_at: user.created_at } })
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
    if (err instanceof Error) {
      if (err.message === "Invalid token signature" || err.message === "Token expired") {
        return c.json({ error: "Authentication failed" }, 401)
      }
    }
    return c.json({ error: "Failed to change password" }, 500)
  }
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
    if (err instanceof Error) {
      if (err.message === "Invalid token signature" || err.message === "Token expired") {
        return c.json({ error: "Authentication failed" }, 401)
      }
    }
    return c.json({ error: "Failed to get user" }, 500)
  }
})

export default authRoutes
