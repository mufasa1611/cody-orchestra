# Cody Pro Quickstart

## Start The TUI

Global command:

```powershell
cody-pro
```

Install with one command from PowerShell:

```powershell
iwr https://raw.githubusercontent.com/mufasa1611/cody-pro/master/install.ps1 | iex
```

Or from CMD:

```cmd
powershell -NoP -c "iwr https://raw.githubusercontent.com/mufasa1611/cody-pro/master/install.ps1 | iex"
```

The installer clones the repository, checks Git/Node.js/Bun (installing missing tools with winget when possible), runs bun install, and creates the global cody-pro command.

If you prefer to clone manually:

```powershell
git clone https://github.com/mufasa1611/cody-pro.git
cd cody-pro
.\install.bat
```

From the checkout directory:

```powershell
.\cody-pro.cmd
```


The fork config sets `operator` as the default primary agent, so this starts Cody Pro in operator mode from the repo root.

Equivalent Bun command:

```powershell
bun run cody-pro
```

Cody Pro branding is the default in this fork, even when launching from `packages/cody`. Set `CODY_PRO=0` only if you need to inspect the inherited upstream branding.

Pass a project path if you want Cody Pro to open somewhere else:

```powershell
.\cody-pro.cmd C:\path\to\project
```

Start with a primary agent:

```powershell
.\cody-pro.cmd --agent operator
```

You can still explicitly choose an upstream agent:

```powershell
.\cody-pro.cmd --agent build
```

## Useful Checks

```powershell
cody-pro --help
.\cody-pro.cmd --help
.\cody-pro.cmd agent list
.\cody-pro.cmd debug agent operator
```

If the global command is missing, reinstall the local shim:

```powershell
.\install.bat
```

## Local Model Discovery

On first normal startup, Cody Pro discovers local Ollama models and `.gguf` files, then writes a generated config:

```text
.cody\generated\cody.jsonc
```

During that scan it prints `[cody-pro:model-scan]` progress lines so you can see the current phase, drive, folder, and found model count. Refresh later with:

```powershell
$env:CODY_REFRESH_MODELS='1'
cody-pro
```

Skip discovery for one launch:

```powershell
$env:CODY_SKIP_MODEL_DISCOVERY='1'
cody-pro
```

Local model setup notes are in `CODY_LOCAL_MODELS.md`.

## Notes

- The upstream `cody` entry point also works for testing upstream behavior.
- The first launch may run a local database migration.
- Keep dangerous infra actions permission-gated. Cody Pro agents should inspect first and ask before mutating systems.


