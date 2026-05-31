# Cody Pro Provider Policy

Cody Pro is local-first, not local-only.

## Local Providers

The launcher discovers local models and writes generated provider config to:

```text
<repo>\.cody\generated\cody.jsonc
```

Generated provider IDs:

- `ollama-local`
- `llama-cpp-local`

This generated file is ignored by git and can be rebuilt on startup.

## Cloud Providers

Cloud providers remain available through cody's normal provider system. Cody Pro does not require cloud auth to start, list local models, or use local providers.

The project config intentionally keeps:

```jsonc
"provider": {}
```

That means Cody Pro is not replacing upstream provider discovery with a hard-coded provider list.

## Verification

```powershell
cody-pro models ollama-local
cody-pro models llama-cpp-local
cody-pro models cody
```

Local provider commands should work without cloud credentials. Cloud provider commands may require their normal upstream authentication, but they should remain present.


