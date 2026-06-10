import fs from "node:fs"
import path from "node:path"
import { Global } from "@cody/core/global"
import * as Jwt from "./jwt"
import { getUser } from "./service"

const FALLBACK_NAME = "workspace"

function safeSegment(input: string | undefined): string {
  const trimmed = (input ?? "").trim()
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  return safe || FALLBACK_NAME
}

export function userWorkspaceRoot(userID: string): string {
  const user = getUser(userID)
  const owner = safeSegment(user?.username ?? userID)
  const dir = path.join(Global.Path.data, "users", owner)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function userWorkspaceRootFromAuthHeader(authHeader: string | undefined): string | undefined {
  const userID = Jwt.userIdFromBearer(authHeader)
  return userID ? userWorkspaceRoot(userID) : undefined
}

