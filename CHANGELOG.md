# Changelog

## Unreleased

### Added

- Created codyx as an cody-based fork.
- Added `codyx` launcher and global Windows command shims.
- Added codyx CLI help branding and startup banner.
- Added local model discovery for Ollama and GGUF files.
- Added Cody operator, infra, backup, and web research agents.
- Added guarded read-only tools for Windows, SSH, Docker, systemd, Proxmox, and backup inventory.
- Added isolated Cody web research tools for search, page read, source notes, and citations.
- Added Cody extension, safety, provider, and legacy audit docs.

### Changed

- Set `operator` as the default codyx primary agent.
- Kept cloud providers available while making local providers sufficient for startup.
- Retired Cody v1 from runtime scope and kept it as a legacy checklist only.

### Removed

- Removed Synology support from the current codyx scope.
