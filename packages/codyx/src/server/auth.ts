export * as ServerAuth from "./auth"

import { ConfigService } from "@/effect/config-service"
import { Flag } from "@cody/core/flag/flag"
import { Config as EffectConfig, Context, Option, Redacted } from "effect"

const DEFAULT_USERNAME = "cody-x"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export class Config extends ConfigService.Service<Config>()("@cody/ServerAuthConfig", {
  password: EffectConfig.string("CODY_SERVER_PASSWORD").pipe(EffectConfig.option),
  username: EffectConfig.string("CODY_SERVER_USERNAME").pipe(EffectConfig.withDefault(DEFAULT_USERNAME)),
}) {}

export type Info = Context.Service.Shape<typeof Config>

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  return (
    Option.isSome(config.password) &&
    credentials.username === config.username &&
    Redacted.value(credentials.password) === config.password.value
  )
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? Flag.CODY_SERVER_PASSWORD
  if (!password) return undefined

  const username = credentials?.username ?? Flag.CODY_SERVER_USERNAME ?? DEFAULT_USERNAME
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
