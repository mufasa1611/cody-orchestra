export function createLocalCliFetch(
  dispatch: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      request.headers.set("x-cody-cli-local", "1")
      return dispatch(request)
    },
    { preconnect: globalThis.fetch.preconnect },
  )
}
