import type { MiddlewareHandler } from "hono"
import { WithInstance } from "@/project/with-instance"
import { AppFileSystem } from "@cody/core/filesystem"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { WorkspaceID } from "@/control-plane/schema"
import { userWorkspaceRootFromAuthHeader } from "@/server/auth/user-workspace"

export function InstanceMiddleware(workspaceID?: WorkspaceID): MiddlewareHandler {
  return async (c, next) => {
    const raw =
      c.req.query("directory") ||
      c.req.header("x-cody-directory") ||
      userWorkspaceRootFromAuthHeader(c.req.header("authorization")) ||
      process.cwd()
    const directory = AppFileSystem.resolve(
      (() => {
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      })(),
    )

    return WorkspaceContext.provide({
      workspaceID,
      async fn() {
        return WithInstance.provide({
          directory,
          async fn() {
            return next()
          },
        })
      },
    })
  }
}
