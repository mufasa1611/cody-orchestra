import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Permission.ReplyBody
    }) {
      yield* svc.reply({
        requestID: ctx.params.requestID,
        reply: ctx.payload.reply,
        message: ctx.payload.message,
      })
      return true
    })

    const setMode = Effect.fn("PermissionHttpApi.setMode")(function* (ctx: {
      payload: { mode: "restricted" | "standard" | "full" }
    }) {
      yield* svc.setMode(ctx.payload.mode)
      return true
    })

    const getMode = Effect.fn("PermissionHttpApi.getMode")(function* () {
      return yield* svc.getMode()
    })

    return handlers.handle("list", list).handle("reply", reply).handle("setMode", setMode).handle("getMode", getMode)
  }),
)
