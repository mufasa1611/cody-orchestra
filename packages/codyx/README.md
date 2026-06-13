# codyx-ai

The npm release is published by `.github/workflows/publish-npm.yml`. The
repository must contain an `NPM_TOKEN` Actions secret with permission to
publish `codyx-ai` and its `codyx-ai-*` platform packages.

## Workflow

```mermaid
flowchart TD
    subgraph Build ["Build (build.ts)"]
        A1["bun run script/build.ts"] --> A2["Cross-compile 12 targets<br/>(linux/darwin/win32 × arm64/x64 × glibc/musl × avx2/baseline)"]
        A2 --> A3["dist/codyx-ai-{os}-{arch}[-baseline][-musl]/<br/>bin/codyx + package.json"]
    end

    subgraph Publish ["Publish (publish.ts)"]
        B1["bun run script/publish.ts"] --> B2["npm publish each platform package<br/>codyx-ai-{os}-{arch}..."]
        B2 --> B3["Create wrapper codyx-ai<br/>bin: { codyx, cody }<br/>optionalDependencies: platform pkgs<br/>postinstall: postinstall.mjs"]
        B3 --> B4["npm publish codyx-ai"]
        B3 --> B5["Docker build & push<br/>ghcr.io/..."]
        B3 --> B6["Update AUR & Homebrew<br/>formulas"]
    end

    subgraph Install ["Install (end-user)"]
        C1["npm install -g codyx-ai"] --> C2["npm installs matching<br/>codyx-ai-{os}-{arch} as<br/>optional dependency"]
        C2 --> C3["postinstall.mjs runs"]
        C3 --> C4["require.resolve('codyx-ai-{p}-{a}')"]
        C4 --> C5["link binary → bin/.cody<br/>(bin/.cody.exe on Windows)"]
    end

    subgraph Runtime ["Runtime"]
        D1["user runs 'codyx' or 'cody'"]
        D1 --> D2["bin/codyx → _launcher.js('codyx')<br/>bin/cody  → _launcher.js('cody')"]
        D2 --> D3{"CODY_BIN_PATH set?"}
        D3 -->|yes| D4["run that path"]
        D3 -->|no| D5{"bin/.cody exists?"}
        D5 -->|yes| D4
        D5 -->|no| D6["walk node_modules for<br/>codyx-ai-{p}-{a}/bin/codyx"]
        D6 --> D7{"found?"}
        D7 -->|yes| D4
        D7 -->|no| D8["show error with<br/>fallback package names"]
        D4 --> D9["spawn binary, forward args & signals"]
    end

    A3 -.->|"CI triggers"| B1
    B3 -.->|"npm registry"| C1
    C5 -.->|"bin/.cody"| D5
```

### Scripts

| Script | Purpose |
|---|---|
| `script/build.ts` | Cross-compile platform-specific standalone binaries via Bun.compile |
| `script/publish.ts` | Publish platform packages + wrapper to npm, Docker, AUR, Homebrew |
| `script/postinstall.mjs` | End-user postinstall: links correct platform binary into `bin/.cody` |
| `bin/_launcher.js` | Shared runtime launcher: finds & spawns the platform binary |
| `bin/codyx` | Thin wrapper → `_launcher('codyx')` |
| `bin/cody` | Thin wrapper → `_launcher('cody')` |
| `script/fix-node-pty.ts` | Dev-only: fix node-pty spawn-helper permissions (runs from root postinstall) |
| `script/generate.ts` | SDK code generation (imported by build.ts) |
| `Dockerfile` | Multi-arch Alpine image (libgcc, libstdc++, ripgrep) |
| `drizzle.config.ts` | Drizzle Kit schema/migration config
