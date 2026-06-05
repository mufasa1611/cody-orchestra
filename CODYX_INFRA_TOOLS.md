# Cody Pro Infra Tools

## Guarded Windows Inspection

Tool: `cody-windows-inspect`

Location:

```text
<repo>\.cody\tool\cody-windows-inspect.ts
```

Purpose:

- Run predefined read-only Windows diagnostics.
- Avoid arbitrary PowerShell input.
- Return command output, stderr, exit code, and timeout status.

Profiles:

- `system`
- `drives`
- `network`
- `processes`
- `services`
- `docker`

Smoke test:

```powershell
cody-pro debug agent windows-admin --tool cody-windows-inspect --params '"{\"check\":\"system\",\"timeoutSeconds\":10}"'
```

This is an inspection tool only. Mutating operations still require explicit user approval and should be implemented as separate, guarded tools.

## Guarded SSH Inspection

Tool: `cody-ssh-inspect`

Location:

```text
<repo>\.cody\tool\cody-ssh-inspect.ts
```

Purpose:

- Run predefined read-only SSH diagnostics.
- Avoid arbitrary remote shell input.
- Return command output, stderr, exit code, and timeout status.

Profiles:

- `client`
- `system`
- `disk`
- `memory`
- `processes`
- `docker`
- `services`

Smoke test:

```powershell
cody-pro debug agent ssh-operator --tool cody-ssh-inspect --params '"{\"check\":\"client\",\"timeoutSeconds\":10}"'
```

Remote checks require a `host` value and run with `BatchMode=yes`, so they will fail fast instead of prompting for passwords.

## Guarded Docker Inspection

Tool: `cody-docker-inspect`

Location:

```text
<repo>\.cody\tool\cody-docker-inspect.ts
```

Purpose:

- Run predefined read-only Docker diagnostics.
- Avoid arbitrary Docker argument input.
- Return command output, stderr, exit code, and timeout status.

Profiles:

- `version`
- `contexts`
- `containers`
- `images`
- `volumes`
- `networks`
- `system`
- `compose`

Smoke test:

```powershell
cody-pro debug agent docker-operator --tool cody-docker-inspect --params '"{\"check\":\"version\",\"timeoutSeconds\":10}"'
```

The `compose` profile can receive `projectPath` as a working directory, but mutating compose commands remain out of scope for this inspection tool.

## Guarded systemd Inspection

Tool: `cody-systemd-inspect`

Location:

```text
<repo>\.cody\tool\cody-systemd-inspect.ts
```

Purpose:

- Run predefined read-only systemd and journal diagnostics.
- Support local Linux checks or remote SSH checks.
- Avoid arbitrary `systemctl` or `journalctl` input.

Profiles:

- `version`
- `failed`
- `services`
- `timers`
- `status`
- `cat`
- `journal`

Smoke test:

```powershell
cody-pro debug agent systemd-operator --tool cody-systemd-inspect --params '"{\"check\":\"version\",\"timeoutSeconds\":10}"'
```

Remote checks accept `host`, optional `user`, and optional `port`. Unit-specific profiles require a sanitized `unit` value such as `ssh.service`.

## Guarded Proxmox Inspection

Tool: `cody-proxmox-inspect`

Location:

```text
<repo>\.cody\tool\cody-proxmox-inspect.ts
```

Purpose:

- Run predefined read-only Proxmox API diagnostics.
- Avoid arbitrary API path input.
- Return HTTP status and response body without exposing mutation paths.

Profiles:

- `version`
- `nodes`
- `cluster`
- `resources`
- `storage`
- `guestStatus`
- `guestConfig`
- `snapshots`
- `backups`

Configuration:

```powershell
$env:CODY_PROXMOX_URL = "https://pve.local:8006"
$env:CODY_PROXMOX_TOKEN_ID = "user@pam!token"
$env:CODY_PROXMOX_TOKEN_SECRET = "secret"
```

Smoke test:

```powershell
cody-pro debug agent proxmox-operator --tool cody-proxmox-inspect --params '"{\"check\":\"version\",\"timeoutSeconds\":10}"'
```

Guest checks require `node`, `guestKind`, and `vmid`. Backup checks require `node` and `storage`.

## Guarded Backup Inventory

Tool: `cody-backup-inventory`

Location:

```text
<repo>\.cody\tool\cody-backup-inventory.ts
```

Purpose:

- Run bounded read-only backup inventory checks.
- List backup-like files by extension, recency, or size.
- Calculate SHA-256 for a specific file when requested.

Profiles:

- `summary`
- `inventory`
- `recent`
- `large`
- `checksum`

Smoke test:

```powershell
cody-pro debug agent backup-operator --tool cody-backup-inventory --params '"{\"check\":\"summary\",\"root\":\"D:\\\\cody-pro\",\"maxDepth\":2,\"maxItems\":25}"'
```

The scanner does not follow symlinks and defaults to bounded recursion. Restore, delete, prune, rotate, or overwrite actions remain outside this tool.


