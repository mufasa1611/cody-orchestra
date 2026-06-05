# Cody Pro Safety Model

## Current Rule

Cody Pro's infrastructure tools are inspection-only right now. They are allowed to read state, summarize it, and recommend a next action. They must not start, stop, restart, delete, prune, restore, overwrite, expose, migrate, resize, rotate, or edit infrastructure.

## Permission Boundary

Infrastructure agents use:

```yaml
permission:
  edit: deny
  bash: ask
  task: deny
```

The primary `operator` can delegate with `task: allow`, but still has `edit: deny` and `bash: ask`.

This means repository edits are blocked for infra agents, shell commands require approval, and Cody's default route is to use predefined read-only tools first.

## Mutation Path

Before Cody Pro gets any mutation tool, that tool must have:

- A separate tool file from the read-only inspection tool.
- A narrow operation enum instead of arbitrary command input.
- Explicit target arguments with validation.
- A dry-run or preview mode when the platform supports it.
- Agent guidance that asks before execution.
- A smoke test for refusal or preview behavior.

## Current Read-Only Tools

- `cody-windows-inspect`
- `cody-ssh-inspect`
- `cody-docker-inspect`
- `cody-systemd-inspect`
- `cody-proxmox-inspect`
- `cody-backup-inventory`

No Cody mutation tool exists yet.


