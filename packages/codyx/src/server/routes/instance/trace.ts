import type { Context } from "hono"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import * as Jwt from "@/server/auth/jwt"
import { UserRef } from "@/effect/instance-ref"

type AppEnv = Parameters<typeof AppRuntime.runPromise>[0] extends Effect.Effect<any, any, infer R> ? R : never

export interface RequestLike {
  readonly req: {
    readonly method: string
    readonly url: string
    param(): Record<string, string>
  }
}

export function paramToAttributeKey(key: string): string {
  const m = key.match(/^(.+)ID$/)
  if (m) return `${m[1].toLowerCase()}.id`
  return `cody.${key}`
}

export function requestAttributes(c: RequestLike): Record<string, string> {
  const attributes: Record<string, string> = {
    "http.method": c.req.method,
    "http.path": new URL(c.req.url).pathname,
  }
  for (const [key, value] of Object.entries(c.req.param())) {
    attributes[paramToAttributeKey(key)] = value
  }
  return attributes
}

export function runRequest<A, E>(name: string, c: Context, effect: Effect.Effect<A, E, AppEnv>) {
  const userId = Jwt.userIdFromBearer(c.req.header("Authorization"))
  const withUser = userId ? effect.pipe(Effect.provideService(UserRef, userId)) : effect
  return AppRuntime.runPromise(withUser.pipe(Effect.withSpan(name, { attributes: requestAttributes(c) })))
}

export async function jsonRequest<C extends Context, A, E>(
  name: string,
  c: C,
  effect: (c: C) => Effect.gen.Return<A, E, AppEnv>,
) {
  return c.json(
    await runRequest(
      name,
      c,
      Effect.gen(() => effect(c)),
    ),
  )
}
