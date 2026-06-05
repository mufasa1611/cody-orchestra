# Cody Pro Local Models

Cody Pro keeps the upstream provider system. Use these snippets when you want local/private models through Ollama, LM Studio, or another OpenAI-compatible server.

Do not paste all examples at once. Pick one provider and model that actually exists on your machine.

## Ollama

Start Ollama and pull a tool-capable model:

```powershell
ollama pull qwen2.5-coder:7b
ollama serve
```

Add this to `.cody/cody.jsonc` under the top-level config:

```jsonc
{
  "model": "ollama/qwen2.5-coder:7b",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": {
        "baseURL": "http://localhost:11434/v1",
        "apiKey": "ollama"
      },
      "models": {
        "qwen2.5-coder:7b": {
          "name": "Qwen 2.5 Coder 7B (local)",
          "tool_call": true,
          "limit": {
            "context": 32768,
            "output": 8192
          }
        }
      }
    }
  }
}
```

Launch Cody Pro with that model explicitly:

```powershell
.\cody-pro.cmd --model ollama/qwen2.5-coder:7b
```

## LM Studio

Start an LM Studio local server on port `1234`, then add:

```jsonc
{
  "model": "lmstudio/local-model",
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://localhost:1234/v1",
        "apiKey": "lm-studio"
      },
      "models": {
        "local-model": {
          "name": "LM Studio Local Model",
          "tool_call": true
        }
      }
    }
  }
}
```

Launch Cody Pro with:

```powershell
.\cody-pro.cmd --model lmstudio/local-model
```

## Notes

- Keep `operator` as the default agent unless you are testing upstream agent behavior.
- If tool calls fail with a local model, choose a model that supports tool calling or disable tool-heavy workflows.
- If context is too small, increase the model/server context setting first, then update the `limit.context` value.
- Cloud providers still work through the normal /connect and providers commands.

## Auto Discovery

Cody Pro runs local model discovery on first normal startup and writes generated provider config to:

```text
<repo>\.cody\generated\cody.jsonc
```

It discovers:

- `ollama-local/*` models from `ollama list` and Ollama manifest folders. Ollama `:cloud` entries are skipped.
- `llama-cpp-local/*` models from `.gguf` files found across fixed drives. Split GGUF sets are collapsed to the first shard.

Refresh discovery:

```powershell
$env:CODY_REFRESH_MODELS='1'
cody-pro
```

Skip discovery for one launch:

```powershell
$env:CODY_SKIP_MODEL_DISCOVERY='1'
cody-pro
```

Set an unlimited scan when you want every drive walked fully:

```powershell
$env:CODY_REFRESH_MODELS='1'
$env:CODY_MODEL_SCAN_MAX_SECONDS='0'
cody-pro
```


