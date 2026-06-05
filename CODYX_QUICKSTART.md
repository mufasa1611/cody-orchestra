# codyx Quickstart

## Start The TUI

Global command:

```powershell
codyx
```

Install with one command from PowerShell:

```powershell
iwr https://raw.githubusercontent.com/mufasa1611/cody-orchestra/master/install.ps1 | iex
```

Or from CMD:

```cmd
powershell -NoP -c "iwr https://raw.githubusercontent.com/mufasa1611/cody-orchestra/master/install.ps1 | iex"
```

The installer clones the repository, checks Git/Node.js/Bun (installing missing tools with winget when possible), runs bun install, and creates the global codyx command.

If you prefer to clone manually:

```powershell
git clone https://github.com/mufasa1611/cody-orchestra.git
cd codyx
.\install.bat
```

From the checkout directory:

```powershell
.\codyx.cmd
```


The fork config sets `operator` as the default primary agent, so this starts codyx in operator mode from the repo root.

Equivalent Bun command:

```powershell
bun run codyx
```

codyx branding is the default in this fork, even when launching from `packages/cody`. Set `CODY_X=0` only if you need to inspect the inherited upstream branding.

Pass a project path if you want codyx to open somewhere else:

```powershell
.\codyx.cmd C:\path\to\project
```

Start with a primary agent:

```powershell
.\codyx.cmd --agent operator
```

You can still explicitly choose an upstream agent:

```powershell
.\codyx.cmd --agent build
```

## Useful Checks

```powershell
codyx --help
.\codyx.cmd --help
.\codyx.cmd agent list
.\codyx.cmd debug agent operator
```

If the global command is missing, reinstall the local shim:

```powershell
.\install.bat
```

## Local Model Discovery

On first normal startup, codyx discovers local Ollama models and `.gguf` files, then writes a generated config:

```text
.cody\generated\cody.jsonc
```

During that scan it prints `[codyx:model-scan]` progress lines so you can see the current phase, drive, folder, and found model count. Refresh later with:

```powershell
$env:CODY_REFRESH_MODELS='1'
codyx
```

Skip discovery for one launch:

```powershell
$env:CODY_SKIP_MODEL_DISCOVERY='1'
codyx
```

Local model setup notes are in `CODYX_LOCAL_MODELS.md`.

## Notes

- The upstream `cody` entry point also works for testing upstream behavior.
- The first launch may run a local database migration.
- Keep dangerous infra actions permission-gated. codyx agents should inspect first and ask before mutating systems.


