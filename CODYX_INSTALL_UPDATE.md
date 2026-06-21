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

The Windows installer installs Git and Bun 1.3.13+ when needed, then pauses for
email ownership verification before cloning the repository or continuing with
the rest of installation. It explains what is collected, sends a six-digit code,
and stores only a signed receipt under:

```text
%LOCALAPPDATA%\codyx-installer\verification.json
```

The local receipt contains no display name or email address. A valid receipt lets
later runs continue automatically. `-Yes` does not bypass verification, and a
noninteractive run without a valid receipt exits with instructions.

After email verification succeeds, the service stores the registration and
sends an operational notice with the display name, verified email, installation
ID, installer version, platform, and verification time to the Codyx
administrator. The notice never contains the verification code. This identifies
successful users of the official Windows installer; it does not track manual
clones or repository downloads.

After verification, the installer clones the repository, runs `bun install`,
builds the web UI, discovers optional local models, and verifies the global
`codyx` command before finishing. The privacy notice is available at
https://install.kingkung.men/privacy and deletion requests can be sent to
`privacy@kingkung.men`.

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


