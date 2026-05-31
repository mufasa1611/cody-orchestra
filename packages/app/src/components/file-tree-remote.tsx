import { Component, For, Show, createSignal, createResource } from "solid-js"
import { Icon } from "@cody/ui/icon"
import { FileIcon } from "@cody/ui/file-icon"
import { Collapsible } from "@cody/ui/collapsible"

interface RemoteFileNode {
  name: string
  path: string
  type: "file" | "directory"
  size?: number
  modifiedAt?: number
}

function formatSize(bytes?: number): string {
  if (bytes == null) return ""
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

function formatDate(ms?: number): string {
  if (ms == null) return ""
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

async function fetchDir(path: string): Promise<RemoteFileNode[]> {
  const url = new URL("/agent/fs/list", window.location.origin)
  url.searchParams.set("path", path)
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error("Failed to list directory: " + res.statusText)
  const data = await res.json()
  const files: RemoteFileNode[] = data.files ?? []
  // Sort: directories first, then by name
  files.sort((a: RemoteFileNode, b: RemoteFileNode) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return files
}

function FileTreeRemoteNode(props: {
  node: RemoteFileNode
  depth: number
}) {
  const [expanded, setExpanded] = createSignal(false)
  const [items] = createResource(
    () => (expanded() ? props.node.path : null),
    (path) => fetchDir(path),
  )

  const handleClick = () => {
    if (props.node.type === "directory") {
      setExpanded((e) => !e)
    }
  }

  return (
    <div>
      <div
        class="flex items-center gap-x-1.5 rounded-md px-1.5 py-0 text-left h-6 hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors cursor-pointer"
        style={{ "padding-left": `${8 + props.depth * 12}px` }}
        onClick={handleClick}
      >
        <Show when={props.node.type === "directory"}>
          <div class="size-4 flex items-center justify-center text-icon-weak shrink-0">
            <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
          </div>
        </Show>
        <Show when={props.node.type === "file"}>
          <div class="w-4 shrink-0" />
        </Show>
        <div class="size-4 shrink-0 flex items-center">
          <FileIcon
            node={{ path: props.node.path, type: props.node.type }}
            expanded={expanded()}
            class="size-4"
          />
        </div>
        <span class="flex-1 min-w-0 text-12-medium whitespace-nowrap truncate text-text-weak">
          {props.node.name}
        </span>
        <Show when={props.node.type === "file" && props.node.size != null}>
          <span class="text-11-regular text-text-weaker shrink-0 tabular-nums">
            {formatSize(props.node.size)}
          </span>
        </Show>
        <Show when={props.node.modifiedAt != null}>
          <span class="text-11-regular text-text-weaker shrink-0 tabular-nums hidden sm:inline">
            {formatDate(props.node.modifiedAt)}
          </span>
        </Show>
      </div>
      <Show when={props.node.type === "directory" && expanded()}>
        <Show
          when={!items.loading && !items.error}
          fallback={
            <div
              class="text-12-regular text-text-weaker px-1.5 py-1"
              style={{ "padding-left": `${8 + (props.depth + 1) * 12}px` }}
            >
              {items.loading ? "Loading..." : "Error loading directory"}
            </div>
          }
        >
          <For each={items()}>
            {(child) => <FileTreeRemoteNode node={child} depth={props.depth + 1} />}
          </For>
        </Show>
      </Show>
    </div>
  )
}

export default function FileTreeRemote(props: {
  initialPath?: string
}) {
  const [root] = createResource(() => fetchDir(props.initialPath ?? "/"))

  return (
    <div data-component="filetree-remote" class="flex flex-col gap-0.5">
      <Show
        when={!root.loading && !root.error}
        fallback={
          <div class="text-12-regular text-text-weaker px-3 py-2">
            {root.loading ? "Connecting to remote PC..." : "Failed to load remote files"}
          </div>
        }
      >
        <For each={root()}>
          {(node) => <FileTreeRemoteNode node={node} depth={0} />}
        </For>
      </Show>
    </div>
  )
}
