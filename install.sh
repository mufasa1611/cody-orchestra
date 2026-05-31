#!/usr/bin/env bash
set -euo pipefail

REPO="mufasa1611/cody-x"
BRANCH="${CODY_BRANCH:-main}"

echo "[warn] This installer (root 'install.sh') is deprecated." >&2
echo "[warn] Use the unified script/install.sh instead:" >&2
echo "  curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/script/install.sh | bash" >&2
echo "" >&2

NEW_URL="https://raw.githubusercontent.com/$REPO/$BRANCH/script/install.sh"
TMP="$(mktemp)"
if curl -fsSL "$NEW_URL" -o "$TMP" 2>/dev/null; then
  exec bash "$TMP" "$@"
fi
echo "[error] Could not download script/install.sh. Falling through to legacy installer." >&2

REPO_URL="https://github.com/$REPO.git"
DEFAULT_ROOT="${HOME:-~}/.local/share/cody-x"
INSTALLER_URL="https://raw.githubusercontent.com/$REPO/$BRANCH/install.sh"

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
if [ "${CODY_INSTALLER_SELF_UPDATE:-1}" != "0" ] && [ -z "${CODY_INSTALLER_SELF_UPDATED:-}" ] && [ -f "$SCRIPT_PATH" ]; then
  TMP_INSTALLER="$(mktemp)"
  if curl -fsSL "$INSTALLER_URL" -o "$TMP_INSTALLER" 2>/dev/null; then
    if ! cmp -s "$SCRIPT_PATH" "$TMP_INSTALLER"; then
      echo "[info] New installer found. Running latest installer from GitHub..."
      export CODY_INSTALLER_SELF_UPDATED=1
      exec bash "$TMP_INSTALLER" "$@"
    fi
    echo "[ok] Installer is up to date."
  else
    echo "[warn] Could not download latest installer. Continuing with current."
  fi
  rm -f "$TMP_INSTALLER"
fi

# ---- Help ----
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "cody-x Installer for Linux/macOS"
  echo ""
  echo "Usage: curl -fsSL https://raw.githubusercontent.com/mufasa1611/cody-x/$BRANCH/install.sh | bash"
  echo ""
  echo "Environment variables:"
  echo "  CODY_INSTALL_ROOT   Install to a custom path instead of $DEFAULT_ROOT"
  echo "  CODY_BRANCH         Install from a branch, default: $BRANCH"
  echo "  CODY_INSTALLER_SELF_UPDATE Set to 0 to skip installer self-update"
  echo "  (interactive model scan offered at end of install)"
  exit 0
fi

# ---- OS detection ----
OS="$(uname -s)"
ARCH="$(uname -m)"
echo "cody-x installer for $OS ($ARCH)"

case "$OS" in
  Linux) ;;
  Darwin) ;;
  *)
    echo "[error] Unsupported OS: $OS. This installer supports Linux and macOS."
    echo "  For Windows, use install.ps1 instead."
    exit 1
    ;;
esac

# ---- Dependency installation ----
INSTALL_CMD=""
UPDATE_CMD=""
case "$OS" in
  Linux)
    if command -v pkg &>/dev/null; then
      INSTALL_CMD="pkg install -y"
      UPDATE_CMD="pkg update -y"
    elif command -v apt-get &>/dev/null; then
      INSTALL_CMD="apt-get install -y"
      UPDATE_CMD="apt-get update -y"
    elif command -v dnf &>/dev/null; then
      INSTALL_CMD="dnf install -y"
      UPDATE_CMD="dnf check-update || true"
    elif command -v pacman &>/dev/null; then
      INSTALL_CMD="pacman -S --noconfirm"
      UPDATE_CMD="pacman -Syu --noconfirm"
    elif command -v zypper &>/dev/null; then
      INSTALL_CMD="zypper install -y"
      UPDATE_CMD="zypper refresh"
    fi
    ;;
  Darwin)
    if command -v brew &>/dev/null; then
      INSTALL_CMD="brew install"
    fi
    ;;
esac

install_dep() {
  local name="$1" pkg="$2"
  if command -v "$name" &>/dev/null; then
    echo "[ok] $name found."
    return 0
  fi
  if [ -n "$INSTALL_CMD" ]; then
    echo "[info] Installing $name..."
    if [ -n "$UPDATE_CMD" ]; then
      $UPDATE_CMD 2>/dev/null || true
    fi
    if [ "$OS" = "Darwin" ]; then
      $INSTALL_CMD "$pkg"
    else
      if [ "$(id -u)" -ne 0 ]; then
        sudo $INSTALL_CMD "$pkg"
      else
        $INSTALL_CMD "$pkg"
      fi
    fi
    if ! command -v "$name" &>/dev/null; then
      echo "[error] Failed to install $name."
      echo "  Install it manually and rerun this installer."
      exit 1
    fi
    echo "[ok] $name installed."
  else
    echo "[error] $name is required."
    echo "  Install $name manually and rerun this installer."
    exit 1
  fi
}

install_dep "git" "git"

if ! command -v curl &>/dev/null; then
  install_dep "curl" "curl"
fi

# ---- Determine install root ----
ROOT="${CODY_INSTALL_ROOT:-}"
if [ -z "$ROOT" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"name".*"cody"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
    ROOT="$SCRIPT_DIR"
  else
    ROOT="$DEFAULT_ROOT"
  fi
fi

echo "Install target: $ROOT"

# ---- Clone or update ----
check_is_repo() {
  [ -f "$1/package.json" ] && grep -q '"name".*"cody"' "$1/package.json" 2>/dev/null
}

if ! check_is_repo "$ROOT"; then
  echo "cody-x checkout not found. Cloning from GitHub..."
  PARENT="$(dirname "$ROOT")"
  mkdir -p "$PARENT"
  if [ -d "$ROOT" ] && [ "$(ls -A "$ROOT" 2>/dev/null)" ]; then
    echo "[error] $ROOT exists but is not a cody-x checkout."
    echo "  Move it away or set CODY_INSTALL_ROOT, then rerun."
    exit 1
  fi
  git clone --branch "$BRANCH" "$REPO_URL" "$ROOT" || git clone "$REPO_URL" "$ROOT"
  echo "[ok] Cloned to $ROOT"
fi

git config --global --add safe.directory "$ROOT" 2>/dev/null || true

BEFORE_HEAD=""
if [ -d "$ROOT/.git" ]; then
  BEFORE_HEAD=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)
  CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || true)"
  if [ -n "$CURRENT_BRANCH" ] && [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    echo "Switching cody-x checkout from $CURRENT_BRANCH to $BRANCH..."
    if git -C "$ROOT" fetch origin "$BRANCH"; then
      git -C "$ROOT" switch "$BRANCH" || {
        echo "[error] Could not switch to $BRANCH."
        echo "  Back up or commit local changes in $ROOT, then rerun the installer."
        exit 1
      }
    else
      echo "[error] Could not fetch branch $BRANCH."
      exit 1
    fi
  fi
  echo "Updating cody-x checkout..."
  git -C "$ROOT" pull --ff-only 2>/dev/null || echo "[warn] git pull failed; continuing with current checkout."
fi

cd "$ROOT"

# ---- Check if dependencies need updating ----
NEED_INSTALL=false
if [ ! -d "node_modules" ]; then
  NEED_INSTALL=true
elif [ -n "$BEFORE_HEAD" ]; then
  AFTER_HEAD=$(git rev-parse HEAD 2>/dev/null || true)
  if [ -n "$AFTER_HEAD" ] && [ "$BEFORE_HEAD" != "$AFTER_HEAD" ] && git diff "$BEFORE_HEAD".."$AFTER_HEAD" --name-only | grep -qE "^(package\.json|bun\.lock)$"; then
    NEED_INSTALL=true
  fi
fi

# ---- Install Bun ----
install_bun() {
  echo "[info] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  if [ -f "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    echo "[ok] Bun installed."
  else
    echo "[error] Bun installation did not produce a usable bun command."
    exit 1
  fi
}

BUN=""
if command -v bun &>/dev/null; then
  BUN="bun"
elif [ -f "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
  export PATH="$HOME/.bun/bin:$PATH"
fi

if [ -z "$BUN" ]; then
  install_bun
fi

echo "[ok] Bun: $("$BUN" --version 2>/dev/null || echo "$BUN")"

# ---- bun install (skip if deps unchanged) ----
if [ "$NEED_INSTALL" = true ]; then
  echo "Installing cody-x dependencies..."
  set +e
  "$BUN" install
  BUN_EXIT=$?
  set -e
  if [ $BUN_EXIT -ne 0 ]; then
    echo ""
    echo "[warn] Bun install failed (exit code $BUN_EXIT). Retrying with --no-optional..."
    set +e
    "$BUN" install --no-optional
    BUN_RETRY_EXIT=$?
    set -e
    if [ $BUN_RETRY_EXIT -ne 0 ]; then
      echo ""
      echo "[error] Bun install failed again (exit code $BUN_RETRY_EXIT)."
      echo "  This project has many dependencies (~2700 packages) and may need more memory."
      echo "  Try one of these:"
      echo "    1. Increase your swap space, then rerun"
      echo "    2. Run:  $BUN install --frozen-lockfile"
      echo "  Then rerun this installer."
      exit 1
    fi
    echo "[ok] Dependencies installed with --no-optional."
  fi
else
  echo "[ok] Dependencies are up to date. Skipping bun install."
fi

# ---- Build Web UI ----
echo "Building Web UI..."
set +e
"$BUN" run --cwd "$ROOT/packages/app" build
BUILD_EXIT=$?
set -e
if [ $BUILD_EXIT -ne 0 ]; then
  echo "[warn] Web UI build failed; server will proxy to app.cody.ai."
fi

# ---- Create proxy config ----
if [ ! -f "$ROOT/.env.proxy" ]; then
  echo "Creating .env.proxy with proxy settings..."
  cat > "$ROOT/.env.proxy" << 'ENVEOF'
CODY_PROXY_ENABLED=1
HTTPS_PROXY=http://localhost:9999
HTTP_PROXY=http://localhost:9999
NO_PROXY=localhost,127.0.0.1,::1
ENVEOF
  echo "[ok] .env.proxy created with proxy config."
else
  echo "[ok] .env.proxy already exists."
fi
