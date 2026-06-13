# codyx Install And Update Strategy

## Local Install

Install with one command from PowerShell:

```powershell
irm https://raw.githubusercontent.com/mufasa1611/cody-orchestra/main/script/install.ps1 | iex
```

Or from CMD:

```cmd
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/mufasa1611/cody-orchestra/main/script/install.ps1 | iex"
```

The installer clones the repository, installs Git and Bun 1.3.13+ when needed, runs
`bun install`, builds the web UI, discovers optional local models, and verifies the
global `codyx` command before finishing.

If you prefer to clone manually first:

```powershell
git clone https://github.com/mufasa1611/cody-orchestra.git
cd cody-orchestra
.\script\install.ps1
```

If Git is not installed, the installer tries to install Git with `winget` before cloning.

The checkout path is not fixed. On Windows, the global command installer records the current checkout path in shims under your user npm global bin folder, normally:

```text
%APPDATA%\npm\codyx.ps1
%APPDATA%\npm\codyx.cmd
```

Both shims route to the `codyx.cmd` file in your checkout. The folder name is historical; npm itself is not required.

macOS/Linux users can run:

```bash
curl -fsSL https://raw.githubusercontent.com/mufasa1611/cody-orchestra/main/script/install.sh | bash
```

The Unix installer writes the launcher to `~/.local/bin/codyx` and adds that
directory to the current shell configuration when necessary.

## Start Command

```powershell
codyx
```

Explicit operator launch:

```powershell
codyx --agent operator
```

## Update Policy

codyx updates through git from the local checkout. Use:

```powershell
codyx upgrade
```

To refresh dependencies and rebuild the installation, rerun the unified installer
from the checkout:

```powershell
git pull --ff-only
.\script\install.ps1
```

Updates use `git pull --ff-only`, so local divergent changes are not overwritten.

## Reinstall Global Command

If the global shim is missing or stale:

```powershell
.\script\install-codyx-global.ps1 -Root (Get-Location)
```

## Release Checkpoint Criteria

Before tagging a codyx checkpoint:

- Worktree is clean.
- `codyx --help` shows codyx branding.
- `codyx debug agent operator` loads Cody agents and tools.
- Local provider smoke checks pass.
- Focused Cody tool smoke checks pass.
- `bun run typecheck` passes.
- Full test suite has either passed or has documented non-Cody failures.


