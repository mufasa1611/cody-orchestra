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

The public Windows installer installs a user-local Node.js LTS runtime when
needed, then pauses for email ownership verification before installing
`codyx-ai@latest` from npm. It explains what is collected, sends a six-digit
code, and stores only a signed receipt under:

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

After verification, the installer configures a user-owned npm prefix, installs
the prebuilt platform package, and verifies the global `codyx` command before
finishing. No administrator rights, Git checkout, Bun installation, or local
source build is required. The privacy notice is available at
https://install.kingkung.men/privacy and deletion requests can be sent to
`privacy@kingkung.men`.

Developers who clone the repository and run the installer from that checkout
continue to use the source installation path:

```powershell
git clone https://github.com/mufasa1611/cody-orchestra.git
cd cody-orchestra
.\script\install.ps1
```

The npm command shims are installed under the current user's npm prefix, normally:

```text
%APPDATA%\npm\codyx.ps1
%APPDATA%\npm\codyx.cmd
```

The npm launcher selects the correct prebuilt Windows binary and marks the
process as package-managed so update checks never treat the user's current
project repository as the Codyx source checkout.

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

Normal Windows installations update through npm. Use either:

```powershell
codyx upgrade
npm install -g codyx-ai@latest
```

Source/developer installations continue to update through Git:

```powershell
git pull --ff-only
.\script\install.ps1
```

Updates use `git pull --ff-only`, so local divergent changes are not overwritten.

## Reinstall Global Command

For a normal npm installation:

```powershell
npm install -g codyx-ai@latest
```

For a source/developer installation:

```powershell
.\script\install-codyx-global.ps1 -Root (Get-Location)
```

## Publishing

The `publish-npm` GitHub Actions workflow builds every supported platform
package and publishes the existing `codyx-ai` package. It requires the
repository secret `NPM_TOKEN` with publish access to `codyx-ai`. Run the
workflow manually with an exact semantic version and the `latest` or `beta`
distribution tag.

## Release Checkpoint Criteria

Before tagging a codyx checkpoint:

- Worktree is clean.
- `codyx --help` shows codyx branding.
- `codyx debug agent operator` loads Cody agents and tools.
- Local provider smoke checks pass.
- Focused Cody tool smoke checks pass.
- `bun run typecheck` passes.
- Full test suite has either passed or has documented non-Cody failures.
