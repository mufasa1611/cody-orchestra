# codyx Install And Update Strategy

## Local Install

Install with one command from PowerShell:

```powershell
iwr https://raw.githubusercontent.com/mufasa1611/cody-orchestra/master/install.ps1 | iex
```

Or from CMD:

```cmd
powershell -NoP -c "iwr https://raw.githubusercontent.com/mufasa1611/cody-orchestra/master/install.ps1 | iex"
```

The installer clones the repository, checks Git/Node.js/Bun (installing missing tools with `winget` when possible), runs `bun install`, marks the checkout as a Git safe directory, and creates the global `codyx` command.

If you prefer to clone manually first:

```powershell
git clone https://github.com/mufasa1611/cody-orchestra.git
cd codyx
.\install.bat
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
./install
```

## Start Command

```powershell
codyx
```

Explicit operator launch:

```powershell
codyx --agent operator
```

## Update Policy

codyx updates through git from the local checkout. Re-run `install.bat`:

```powershell
.\install.bat
```

This pulls the latest changes (handles Git's "dubious ownership" check automatically) and reinstalls dependencies. To update manually:

```powershell
git pull --ff-only
.\install.bat
```

Do not add an auto-update command until after the first TUI test. The current fork is local and may contain user changes, so automatic pulls would be too risky.

## Reinstall Global Command

If the global shim is missing or stale:

```powershell
.\install.bat
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


