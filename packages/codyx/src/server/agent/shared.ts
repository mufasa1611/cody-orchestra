import { Effect } from "effect"
import type { Interface as AgentHubInterface } from "./hub"

export type RemoteHub = Pick<AgentHubInterface, "listDir" | "readFile" | "writeFile" | "exec">

let hub: RemoteHub | null = null

export function registerHub(h: RemoteHub): void {
  hub = h
}

export function clearHub(): void {
  hub = null
}

export function getRemoteHub(): RemoteHub | null {
  return hub
}
