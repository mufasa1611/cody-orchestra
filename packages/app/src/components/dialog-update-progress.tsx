import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Dialog } from "@cody/ui/dialog"
import { Spinner } from "@cody/ui/spinner"

export function extractUpdateProgress(event: { name: string; details: { type: string; properties?: Record<string, unknown> } }): string | null {
  if (event.details?.type === "update.progress") {
    return (event.details.properties?.message as string) ?? null
  }
  return null
}

export function isUpdateAvailable(event: { name: string; details: { type: string; properties?: Record<string, unknown> } }): { available: true; version: string } | { available: false } {
  if (event.details?.type === "installation.update-available") {
    return { available: true, version: (event.details.properties?.version as string) ?? "latest" }
  }
  return { available: false }
}

type GlobalEvent = {
  name: string
  details: { type: string; properties?: Record<string, unknown> }
}

type GlobalEventCallback = (event: GlobalEvent) => void

export type GlobalEventListener = (callback: GlobalEventCallback) => () => void

type DialogUpdateProgressProps = {
  listen: GlobalEventListener
}

export function DialogUpdateProgress(props: DialogUpdateProgressProps) {
  const [message, setMessage] = createSignal<string | null>(null)

  onMount(() => {
    const unsub = props.listen((e) => {
      const result = extractUpdateProgress(e)
      if (result !== null) setMessage(result)
    })
    onCleanup(unsub)
  })

  return (
    <Show when={message()}>
      <Dialog title="Updating..." fit>
        <div class="flex items-center gap-3 px-6 py-4">
          <Spinner />
          <span class="text-14-regular text-text-strong">{message()}</span>
        </div>
      </Dialog>
    </Show>
  )
}
