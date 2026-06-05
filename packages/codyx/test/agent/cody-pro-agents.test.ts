import { test, expect } from "bun:test"
import path from "path"
import { ConfigAgent } from "../../src/config/agent"
import { Permission } from "../../src/permission"

const root = path.resolve(import.meta.dir, "../../../..")
const permissionObject = (value: unknown) => (typeof value === "object" && value ? (value as Record<string, string>) : {})

test("Cody Pro project agents load from .cody/agent", async () => {
  const agents = await ConfigAgent.load(path.join(root, ".cody"))
  const operatorBash = permissionObject(agents.operator?.permission?.bash)

  expect(agents.operator?.mode).toBe("primary")
  expect(agents.operator?.permission?.edit).toBe("deny")
  expect(operatorBash["*"]).toBe("allow")
  expect(operatorBash["rm *"]).toBe("ask")
  expect(operatorBash["ssh *"]).toBe("ask")
  expect(agents.operator?.permission?.external_directory).toBe("allow")
  expect(agents.operator?.permission?.task).toBe("allow")

  const operatorRules = Permission.fromConfig(agents.operator!.permission!)
  expect(Permission.evaluate("bash", "Get-PSDrive -PSProvider FileSystem", operatorRules).action).toBe("allow")
  expect(Permission.evaluate("bash", "find test.txt", operatorRules).action).toBe("allow")
  expect(Permission.evaluate("external_directory", "D:/*", operatorRules).action).toBe("allow")
  expect(Permission.evaluate("bash", "Remove-Item test.txt", operatorRules).action).toBe("ask")
  expect(Permission.evaluate("bash", "echo test > output.txt", operatorRules).action).toBe("ask")

  for (const name of [
    "infra-audit",
    "windows-admin",
    "ssh-operator",
    "docker-operator",
    "systemd-operator",
    "proxmox-operator",
    "backup-operator",
    "web-research",
  ]) {
    expect(agents[name]?.mode).toBe("subagent")
  }

  const windowsBash = permissionObject(agents["windows-admin"]?.permission?.bash)
  expect(windowsBash["*"]).toBe("allow")
  expect(windowsBash["Remove-Item *"]).toBe("ask")

  expect(agents["web-research"]?.permission?.bash).toBe("deny")
  expect(agents["web-research"]?.permission?.edit).toBe("deny")
  expect(agents["web-research"]?.permission?.webfetch).toBe("allow")
  expect(agents["web-research"]?.permission?.websearch).toBe("allow")

  expect(Object.keys(agents).some((name) => name.includes("synology"))).toBe(false)
})
