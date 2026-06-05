import type { Provider } from "@cody/sdk/v2"

export function index(list: Provider[] | undefined) {
  return new Map((list ?? []).map((item) => [item.id, item] as const))
}

export function get(list: Provider[] | ReadonlyMap<string, Provider> | undefined, providerID: string, modelID: string) {
  const provider =
    list instanceof Map
      ? list.get(providerID)
      : Array.isArray(list)
        ? list.find((item) => item.id === providerID)
        : undefined
  return provider?.models[modelID]
}

const displayNameOverrides: Record<string, string> = {
  "opencode/big-pickle": "Sandra Pickle",
  "opencode/deepseek-v4-flash-free": "Sandra Seek",
}

export function name(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
) {
  return displayNameOverrides[`${providerID}/${modelID}`] ?? get(list, providerID, modelID)?.name ?? modelID
}
