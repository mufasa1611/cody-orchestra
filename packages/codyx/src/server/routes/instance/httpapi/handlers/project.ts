import { AppRuntime } from "@/effect/app-runtime"
import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForReload } from "../lifecycle"

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectID }
      payload: Project.UpdatePayload
    }) {
      return yield* svc.update({ ...ctx.payload, projectID: ctx.params.projectID })
    })

    const createRaw = Effect.fn("ProjectHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      yield* Effect.logInfo("createRaw: reading body")
      const body = yield* Effect.orDie(ctx.request.text)
      console.log("BODY TYPE:", typeof body, "LENGTH:", body.length, "FIRST:", body.slice(0, 10))
      yield* Effect.logInfo("createRaw: body length", { length: body.length })
      const json = yield* Effect.try({
        try: () => JSON.parse(body) as { directory: string },
        catch: () => new HttpApiError.BadRequest({}),
      })
      yield* Effect.logInfo("createRaw: parsed json", { directory: json.directory })
      const payload = yield* Schema.decodeUnknownEffect(Schema.Struct({ directory: Schema.String }))(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      yield* Effect.logInfo("createRaw: decoded payload", { directory: payload.directory })
      const { project } = yield* svc.create(payload.directory)
      yield* Effect.logInfo("createRaw: created project", { projectId: project.id })
      return project
    })

    return handlers.handle("list", list).handle("current", current).handle("initGit", initGit).handle("update", update).handleRaw("create", createRaw)
  }),
)
