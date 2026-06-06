import { generateSpecs } from \"hono-openapi\"
import { Hono } from \"hono\"
import { adapter } from \"#hono\"
import { lazy } from \"@/util/lazy\"
import * as Log from \"@cody/core/util/log\"
import { Flag } from \"@cody/core/flag/flag\"
import { WorkspaceID } from \"@/control-plane/schema\"
import { ConfigProvider, Context, Effect, Exit, Layer, Scope } from \"effect\"
import { HttpRouter, HttpServer } from \"effect/unstable/http\"
import { OpenApi } from \"effect/unstable/httpapi\"
import * as HttpApiServer from \"#httpapi-server\"
import { MDNS } from \"./mdns\"
import { ensureWebUIBuilt } from \"./shared/ensure-ui\"
import { AuthMiddleware, CompressionMiddleware, CorsMiddleware, ErrorMiddleware, LoggerMiddleware } from \"./middleware\"
import { FenceMiddleware } from \"./fence\"
import { initProjectors } from \"./projectors\"
import { InstanceRoutes } from \"./routes/instance\"
import { ControlPlaneRoutes } from \"./routes/control\"
import { UIRoutes } from \"./routes/ui\"
import { GlobalRoutes } from \"./routes/global\"
import { AgentRoutes } from \"./agent/rest\"
import AuthRoutes from \"./routes/auth\"
import { WorkspaceRouterMiddleware } from \"./workspace\"
import { InstanceMiddleware } from \"./routes/instance/middleware\"
import { WorkspaceRoutes } from \"./routes/control/workspace\"
import { ensureSecret } from \"./auth/jwt\"
import { ensureAdmin } from \"./auth/service\"
import { ExperimentalHttpApiServer } from \"./routes/instance/httpapi/server\"
import { disposeMiddleware } from \"./routes/instance/httpapi/lifecycle\"
import { WebSocketTracker } from \"./routes/instance/httpapi/websocket-tracker\"
import { PublicApi } from \"./routes/instance/httpapi/public\"
import * as ServerBackend from \"./backend\"
import type { CorsOptions } from \"./cors\"
import * as HttpServerRequest from \"effect/unstable/http/HttpServerRequest\"
import * as HttpServerResponse from \"effect/unstable/http/HttpServerResponse\"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

initProjectors()

const log = Log.create({ service: \"server\" })

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

type ServerApp = {
  fetch(request: Request): Response | Promise<Response>
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>    
}

type ListenOptions = CorsOptions & {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
}

const DefaultHono = lazy(() =>
  withBackend({ backend: \"hono\", reason: \"stable\" }, createHono({}, { backend: \"hono\", reason: \"stable\" })),
)
const DefaultHttpApi = lazy(() => createDefaultHttpApi())

function select() {
  return ServerBackend.select()
}

export const backend = select

export const Default = () => {
  const selected = select()
  return selected.backend === \"effect-httpapi\" ? DefaultHttpApi() : DefaultHono()
}

function create(opts: ListenOptions) {
  const selected = select()
  return selected.backend === \"effect-httpapi\"
    ? withBackend(selected, createHttpApi(opts))
    : withBackend(selected, createHono(opts, selected))
}

export function Legacy(opts: CorsOptions = {}) {
  return withBackend({ backend: \"hono\", reason: \"explicit\" }, createHono(opts, { backend: \"hono\", reason: \"explicit\" }))
}

function createDefaultHttpApi() {
  return withBackend(select(), createHttpApi())
}

function withBackend<T extends { app: ServerApp; runtime: unknown }>(selection: ServerBackend.Selection, built: T) {
  log.info(\"server backend selected\", ServerBackend.attributes(selection))
  return built
}

function createHttpApi(corsOptions?: CorsOptions) {
  const handler = ExperimentalHttpApiServer.webHandler(corsOptions).handler
  const context = ExperimentalHttpApiServer.context

  // MINIMAL WRAPPER: Only for the legacy AuthRoutes if needed.
  // Actually, we want to AVOID this wrapper for WebSockets.
  const app = new Hono()
    .onError(ErrorMiddleware)
    .use(CorsMiddleware(corsOptions))
    .route(\"/api/auth\", AuthRoutes)
    .all(\"/*\", (c) => handler(c.req.raw, context))

  return {
    app,
    runtime: adapter.createFetch(app),
  }
}

function createHono(opts: CorsOptions, selection: ServerBackend.Selection = ServerBackend.force(select(), \"hono\")) {
  const backendAttributes = ServerBackend.attributes(selection)
  const app = new Hono()
    .onError(ErrorMiddleware)
    .use(CorsMiddleware(opts))
    .use(LoggerMiddleware(backendAttributes))
    .use(AuthMiddleware)
    .use(CompressionMiddleware)
    .route(\"/global\", GlobalRoutes())
    .route(\"/agent\", AgentRoutes())
    .route(\"/api/auth\", AuthRoutes)

  const runtime = adapter.create(app)

  if (Flag.CODY_WORKSPACE_ID) {
    return {
      app: app
        .use(InstanceMiddleware(Flag.CODY_WORKSPACE_ID ? WorkspaceID.make(Flag.CODY_WORKSPACE_ID) : undefined))
        .use(FenceMiddleware)
        .route(\"/\", InstanceRoutes(runtime.upgradeWebSocket, opts)),
      runtime,
    }
  }

  const workspaceApp = new Hono()
  const workspaceLegacyApp = new Hono()
    .use(InstanceMiddleware())
    .route(\"/experimental/workspace\", WorkspaceRoutes())
    .use(WorkspaceRouterMiddleware(runtime.upgradeWebSocket))
  workspaceApp.route(\"/\", workspaceLegacyApp)

  return {
    app: app
      .route(\"/\", ControlPlaneRoutes())
      .route(\"/\", workspaceApp)
      .route(\"/\", InstanceRoutes(runtime.upgradeWebSocket, opts))
      .route(\"/\", UIRoutes()),
    runtime,
  }
}

/**
 * Generate the OpenAPI document used by the SDK build.
 */
export async function openapi() {
  return OpenApi.fromApi(PublicApi)
}

/**
 * Hono-derived OpenAPI spec, retained for parity diffing only. Delete once
 * the Hono backend is removed.
 */
export async function openapiHono() {
  const { app } = createHono({})
  const result = await generateSpecs(app, {
    documentation: {
      info: {
        title: \"cody-x\",
        version: \"1.0.0\",
        description: process.env.CODY_PRO === \"0\" ? \"cody api\" : \"Cody Pro API\",
      },
      openapi: \"3.1.1\",
    },
  })
  return result
}

export let url: URL

export async function listen(opts: ListenOptions): Promise<Listener> {
  ensureWebUIBuilt()
  ensureSecret()
  ensureAdmin()
  const selected = select()
  const inner: Listener =
    selected.backend === \"effect-httpapi\" ? await listenHttpApi(opts, selected) : await listenLegacy(opts)

  const next = new URL(inner.url)
  url = next

  const mdns =
    opts.mdns && inner.port && opts.hostname !== \"127.0.0.1\" && opts.hostname !== \"localhost\" && opts.hostname !== \"::1\"
  if (mdns) {
    MDNS.publish(inner.port, opts.mdnsDomain)
  } else if (opts.mdns) {
    log.warn(\"mDNS enabled but hostname is loopback; skipping mDNS publish\")
  }

  let closing: Promise<void> | undefined
  let mdnsUnpublished = false
  const unpublish = () => {
    if (!mdns || mdnsUnpublished) return
    mdnsUnpublished = true
    MDNS.unpublish()
  }
  return {
    hostname: inner.hostname,
    port: inner.port,
    url: next,
    stop(close?: boolean) {
      unpublish()
      const next = inner.stop(close)
      closing ??= next
      return close ? next.then(() => closing!) : closing
    },
  }
}

async function listenLegacy(opts: ListenOptions): Promise<Listener> {
  const built = create(opts)
  const server = await built.runtime.listen(opts)
  const innerUrl = new URL(\"http://localhost\")
  innerUrl.hostname = opts.hostname
  innerUrl.port = String(server.port)
  return {
    hostname: opts.hostname,
    port: server.port,
    url: innerUrl,
    stop: (close?: boolean) => server.stop(close),
  }
}

/**
 * Run the effect-httpapi backend on a native Effect HTTP server.
 */
async function listenHttpApi(opts: ListenOptions, selection: ServerBackend.Selection): Promise<Listener> {
  log.info(\"server backend selected\", {
    ...ServerBackend.attributes(selection),
    \"cody.server.runtime\": HttpApiServer.name,
  })

  const buildLayer = (port: number) =>
    HttpRouter.serve(ExperimentalHttpApiServer.createRoutes(opts), {
      middleware: disposeMiddleware,
      disableLogger: true,
      disableListenLog: true,
    }).pipe(
      Layer.provideMerge(WebSocketTracker.layer),
      Layer.provideMerge(HttpApiServer.layer({ port, hostname: opts.hostname })),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
    )

  const start = async (port: number) => {
    const scope = Scope.makeUnsafe()
    try {
      const layer = buildLayer(port) as Layer.Layer<
        HttpServer.HttpServer | WebSocketTracker.Service | HttpApiServer.Service,
        unknown,
        never
      >
      const ctx = await Effect.runPromise(Layer.buildWithMemoMap(layer, Layer.makeMemoMapUnsafe(), scope))
      return { scope, ctx }
    } catch (err) {
      await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined)
      throw err
    }
  }

  let resolved: Awaited<ReturnType<typeof start>> | undefined
  if (opts.port === 0) {
    resolved = await start(4097).catch(() => undefined)
    if (!resolved) resolved = await start(0)
  } else {
    resolved = await start(opts.port)
  }
  if (!resolved) throw new Error(`Failed to start server on port ${opts.port}`)

  const server = Context.get(resolved.ctx, HttpServer.HttpServer)
  if (server.address._tag !== \"TcpAddress\") {
    await Effect.runPromise(Scope.close(resolved.scope, Exit.void))
    throw new Error(`Unexpected HttpServer address tag: ${server.address._tag}`)
  }
  const port = server.address.port

  const innerUrl = new URL(\"http://localhost\")
  innerUrl.hostname = opts.hostname
  innerUrl.port = String(port)
  let forceStopPromise: Promise<void> | undefined
  let stopPromise: Promise<void> | undefined
  const forceStop = () => {
    forceStopPromise ??= Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* Context.get(resolved!.ctx, HttpApiServer.Service).closeAll
        yield* Context.get(resolved!.ctx, WebSocketTracker.Service).closeAll
      }),
    ).then(() => undefined)
    return forceStopPromise
  }

  return {
    hostname: opts.hostname,
    port,
    url: innerUrl,
    stop: (close?: boolean) => {
      const requested = close ? forceStop() : Promise.resolve()
      stopPromise ??= requested
        .then(() => Effect.runPromiseExit(Scope.close(resolved!.scope, Exit.void)))
        .then(() => undefined)
      return requested.then(() => stopPromise!)
    },
  }
}

export * as Server from \"./server\"
