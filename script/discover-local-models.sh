#!/usr/bin/env bash
set -euo pipefail

# --- Arguments ---
ROOT=""
REFRESH=0
MAX_SECONDS=30

while [[ $# -gt 0 ]]; do
  case $1 in
    --root) ROOT="$2"; shift 2 ;;
    --refresh) REFRESH=1; shift ;;
    --max-seconds) MAX_SECONDS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$ROOT" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

GENERATED_DIR="$ROOT/.cody/generated"
CONFIG_PATH="$GENERATED_DIR/cody.jsonc"
REPORT_PATH="$GENERATED_DIR/cody-local-models.report.json"

mkdir -p "$GENERATED_DIR"

# Skip if config exists and not refreshing
if [ -f "$CONFIG_PATH" ] && [ "$REFRESH" -eq 0 ]; then
  exit 0
fi

STARTED=$(date +%s)
DEADLINE=$((STARTED + MAX_SECONDS))
NOTES=()
OLLAMA_MODELS_JSON="{}"
GGUF_MODELS_JSON="{}"
OLLAMA_COUNT=0
GGUF_COUNT=0

show_scan() {
  if [ "${CODY_MODEL_DISCOVERY_QUIET:-0}" != "1" ]; then
    echo "[cody-pro:model-scan] $1"
  fi
}

test_expired() {
  [ $(date +%s) -gt $DEADLINE ]
}

get_short_hash() {
  echo -n "$1" | sha1sum | cut -c1-8
}

convert_to_model_id() {
  local name="$1" path="$2"
  local base=$(basename "$name" | sed 's/\.[^.]*$//' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._:-]/-/g' | sed 's/^-//;s/-$//')
  if [ -z "$base" ]; then base="gguf-model"; fi
  local hash=$(get_short_hash "$path")
  echo "$base-$hash"
}

# --- Ollama model discovery ---
find_ollama_models() {
  show_scan "checking Ollama local registry"
  
  if command -v ollama &>/dev/null; then
    show_scan "running: ollama list"
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      local name=$(echo "$line" | awk '{print $1}')
      [ -z "$name" ] && continue
      [[ "$name" == "NAME" ]] && continue
      [[ "$name" == *":cloud" ]] && continue
      
      OLLAMA_MODELS_JSON=$(echo "$OLLAMA_MODELS_JSON" | jq --arg name "$name" --arg tag "ollama list" \
        '. + {($name): {"name": ($name + " (Ollama local)"), "tool_call": true, "limit": {"context": 32768, "output": 8192}, "options": {"codyLocalKind": "ollama-local", "codyLocalSource": $tag}}}')
      OLLAMA_COUNT=$((OLLAMA_COUNT + 1))
      show_scan "found Ollama model: $name"
    done < <(ollama list 2>/dev/null | tail -n +2)
  else
    show_scan "ollama executable not found; checking manifests only"
  fi
  
  # Check manifest directories
  local manifest_roots=()
  if [ -n "${OLLAMA_MODELS:-}" ]; then
    manifest_roots+=("$OLLAMA_MODELS/manifests")
  fi
  manifest_roots+=("$HOME/.ollama/models/manifests")
  
  for root in "${manifest_roots[@]}"; do
    if test_expired; then break; fi
    [ -d "$root" ] || continue
    show_scan "reading Ollama manifests: $root"
    
    while IFS= read -r manifest_file; do
      [ -f "$manifest_file" ] || continue
      local relative="${manifest_file#$root/}"
      local parts=(${relative//\// })
      [ ${#parts[@]} -lt 3 ] && continue
      
      local registry="${parts[0]}"
      local tag="${parts[-1]}"
      local model_parts=("${parts[@]:1:${#parts[@]}-2}")
      
      if [ "$registry" = "registry.ollama.ai" ] && [ "${model_parts[0]}" = "library" ]; then
        model_parts=("${model_parts[@]:1}")
      fi
      [ ${#model_parts[@]} -eq 0 ] && continue
      
      local model_name=$(IFS=/; echo "${model_parts[*]}"):$tag
      OLLAMA_MODELS_JSON=$(echo "$OLLAMA_MODELS_JSON" | jq --arg name "$model_name" --arg tag "manifest:$manifest_file" \
        '. + {($name): {"name": ($name + " (Ollama local)"), "tool_call": true, "limit": {"context": 32768, "output": 8192}, "options": {"codyLocalKind": "ollama-local", "codyLocalSource": $tag}}}')
      OLLAMA_COUNT=$((OLLAMA_COUNT + 1))
      show_scan "found Ollama model: $model_name"
    done < <(find "$root" -type f 2>/dev/null)
  done
}

# --- GGUF file discovery ---
find_gguf_models() {
  show_scan "scanning mounted filesystems for *.gguf files; max seconds: $MAX_SECONDS"
  
  local skip_dirs="Windows|Program Files|Program Files (x86)|System Volume Information|\\\$Recycle.Bin|Recovery|node_modules|\.git|\.svn|\.hg|\.turbo|target|__pycache__|site-packages|\.cache|\.conda|AppData|ProgramData|cache|dist-info|venv|\.venv|env|\.env|bun|npm|pip|share|include|lib|libs|Conda|conda|PKG-INFO|\.github|\.vscode|extensions|common7|CommonExtensions|VSSDK|MSBuild|dotnet|WindowsPowerShell|PowerShell|System32|SysWOW64|assembly|GAC|WinMetadata|fontconfig|freetype|icu|harfbuzz|\.cargo|registry|\.rustup|\.openclaw|\.codex|codex|plugins|vendor_imports|anything-llm|crew-agent|conda_envs|pinokio|store|files|index-v5"
  
  local visited=0
  
  # Get mount points
  while IFS= read -r mount_point; do
    if test_expired; then
      NOTES+=("GGUF scan stopped after $MAX_SECONDS seconds.")
      break
    fi
    
    visited=$((visited + 1))
    if [ $((visited % 500)) -eq 0 ]; then
      show_scan "visited $visited folders, found $GGUF_COUNT GGUF models"
    fi
    
    # Find GGUF files in this mount point
    while IFS= read -r gguf_file; do
      [ -f "$gguf_file" ] || continue
      local leaf=$(basename "$gguf_file")
      
      # Skip split files that aren't the first part
      if [[ "$leaf" =~ -([0-9]{5})-of-([0-9]{5})\.gguf$ ]] && [ "${BASH_REMATCH[1]}" != "00001" ]; then
        continue
      fi
      
      local name=$(basename "$leaf" | sed 's/-00001-of-[0-9]*\.gguf$//' | sed 's/\.[^.]*$//')
      local id=$(convert_to_model_id "$name" "$gguf_file")
      
      # Ensure unique ID
      while echo "$GGUF_MODELS_JSON" | jq -e --arg id "$id" 'has($id)' &>/dev/null; do
        id="$id-$(get_short_hash "$(uuidgen 2>/dev/null || echo $RANDOM)")"
      done
      
      GGUF_MODELS_JSON=$(echo "$GGUF_MODELS_JSON" | jq --arg id "$id" --arg name "$name" --arg path "$gguf_file" \
        '. + {($id): {"name": ($name + " (GGUF local)"), "tool_call": true, "limit": {"context": 32768, "output": 8192}, "options": {"codyLocalKind": "llama-cpp-local", "codyLocalPath": $path}}}')
      GGUF_COUNT=$((GGUF_COUNT + 1))
      show_scan "found GGUF model: $name at $gguf_file"
    done < <(find "$mount_point" -maxdepth 6 -name "*.gguf" -type f 2>/dev/null | head -1000)
  done < <(df -h 2>/dev/null | tail -n +2 | awk '{print $6}' | grep -v "^/$" | head -10)
  
  local elapsed=$(($(date +%s) - STARTED))
  show_scan "GGUF scan done: $GGUF_COUNT models found, visited $visited folders in ${elapsed}s"
}

# --- Main ---
show_scan "starting first-run local model discovery"
show_scan "generated config target: $CONFIG_PATH"

find_ollama_models
find_gguf_models

# Build providers config
PROVIDERS_JSON="{}"

if [ "$OLLAMA_COUNT" -gt 0 ]; then
  PROVIDERS_JSON=$(echo "$PROVIDERS_JSON" | jq --argjson models "$OLLAMA_MODELS_JSON" \
    '. + {"ollama-local": {"npm": "@ai-sdk/openai-compatible", "name": "Ollama Local (auto-discovered)", "options": {"baseURL": "http://localhost:11434/v1", "apiKey": "ollama"}, "models": $models}}')
fi

if [ "$GGUF_COUNT" -gt 0 ]; then
  LLAMA_BASE_URL="${CODY_LLAMA_CPP_BASE_URL:-http://localhost:8080/v1}"
  LLAMA_API_KEY="${CODY_LLAMA_CPP_API_KEY:-llama-cpp}"
  PROVIDERS_JSON=$(echo "$PROVIDERS_JSON" | jq --argjson models "$GGUF_MODELS_JSON" --arg baseUrl "$LLAMA_BASE_URL" --arg apiKey "$LLAMA_API_KEY" \
    '. + {"llama-cpp-local": {"npm": "@ai-sdk/openai-compatible", "name": "llama.cpp Local (auto-discovered GGUF)", "options": {"baseURL": $baseUrl, "apiKey": $apiKey}, "models": $models}}')
fi

# Write config
CONFIG_JSON=$(jq -n --argjson providers "$PROVIDERS_JSON" \
  '{"$schema": "https://cody.dev/config.json", "provider": $providers}')

echo "$CONFIG_JSON" > "$CONFIG_PATH"

# Write report
NOTES_JSON="[]"
for note in "${NOTES[@]}"; do
  NOTES_JSON=$(echo "$NOTES_JSON" | jq --arg note "$note" '. + [$note]')
done

REPORT_JSON=$(jq -n \
  --arg generatedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson maxSeconds "$MAX_SECONDS" \
  --argjson ollamaModelCount "$OLLAMA_COUNT" \
  --argjson ggufModelCount "$GGUF_COUNT" \
  --arg configPath "$CONFIG_PATH" \
  --argjson notes "$NOTES_JSON" \
  '{"generatedAt": $generatedAt, "maxSeconds": $maxSeconds, "ollamaModelCount": $ollamaModelCount, "ggufModelCount": $ggufModelCount, "configPath": $configPath, "notes": $notes}')

echo "$REPORT_JSON" > "$REPORT_PATH"

ELAPSED=$(($(date +%s) - STARTED))
show_scan "done in ${ELAPSED}s. Ollama: $OLLAMA_COUNT, GGUF: $GGUF_COUNT models"
show_scan "model config written to: $CONFIG_PATH"
