#!/usr/bin/env bash
set -euo pipefail

# ── npm fast-path ──────────────────────────────────────────────────────
# If Node.js 18+ is already present, install the pre-built binary from npm
# and skip the full source-build path.  Set CODY_FORCE_SOURCE=1 to bypass.
if [ "${CODY_FORCE_SOURCE:-0}" != "1" ] && command -v node >/dev/null 2>&1; then
  _node_major=$(node --version 2>/dev/null | tr -d 'v' | cut -d. -f1)
  if [ "${_node_major:-0}" -ge 18 ]; then
    _npm_pkg="${CODY_NPM_PACKAGE:-codyx-ai}"
    _npm_tag="${CODY_NPM_TAG:-latest}"
    _npm_spec="$_npm_pkg@$_npm_tag"
    echo -e "\033[0;36m>>\033[0m Node.js $_node_major found — installing $_npm_spec via npm (fast path)..."
    if npm install -g "$_npm_spec" 2>&1; then
      if command -v codyx >/dev/null 2>&1; then
        _ver=$(codyx --version 2>/dev/null || true)
        echo -e "\033[0;32m[ok]\033[0m codyx ${_ver} installed via npm."
        echo -e "\033[0;32m[ok]\033[0m Update: npm update -g $_npm_pkg"
        echo -e "\033[0;32m[ok]\033[0m Uninstall: npm uninstall -g $_npm_pkg"
        exit 0
      fi
    fi
    echo -e "\033[1;33m[warn]\033[0m npm fast-path failed. Falling through to source build..."
  fi
fi

# ── Config ─────────────────────────────────────────────────────────────
REPO_URL="https://github.com/mufasa1611/cody-orchestra.git"
BRANCH="${CODY_BRANCH:-main}"
ROOT="${CODY_INSTALL_ROOT:-$HOME/.local/share/codyx}"
NO_SCAN="${CODY_NO_SCAN:-0}"
NO_PROXY="${CODY_NO_PROXY:-0}"
NO_BUILD="${CODY_NO_BUILD:-0}"
YES="${CODY_YES:-0}"
REBOOT="${CODY_REBOOT:-0}"
CODY_PORT="${CODY_PORT:-4096}"
CODY_HOST="${CODY_HOST:-0.0.0.0}"
PROXY_PORT="${PROXY_PORT:-9999}"
CLOUDFLARED_HOSTNAME="${CODY_TUNNEL_HOSTNAME:-}"
codyproXY_URL="${codyproXY_URL:-}"
IS_SERVER=0
IS_CONTAINER=0
PKG_MGR=""

# ── Colors ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step()  { echo -e "${CYAN}>>${NC} $1"; }
ok()    { echo -e "${GREEN}[ok]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
err()   { echo -e "${RED}[error]${NC} $1"; }

# ── Helpers ────────────────────────────────────────────────────────────

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

bun_version_supported() {
  local version="${1%%-*}"
  local major=0
  local minor=0
  local patch=0
  IFS=. read -r major minor patch <<< "$version"
  major="${major:-0}"
  minor="${minor:-0}"
  patch="${patch:-0}"
  (( major > 1 || (major == 1 && (minor > 3 || (minor == 3 && patch >= 13))) ))
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

detect_pkg_manager() {
  if command_exists apt-get; then PKG_MGR="apt-get"
  elif command_exists dnf; then PKG_MGR="dnf"
  elif command_exists yum; then PKG_MGR="yum"
  elif command_exists zypper; then PKG_MGR="zypper"
  elif command_exists pacman; then PKG_MGR="pacman"
  else PKG_MGR=""
  fi
}

pkg_install() {
  local pkg="$1"
  local runner=()
  if ! is_root; then
    if command_exists sudo; then
      runner=(sudo)
    else
      return 1
    fi
  fi
  case "$PKG_MGR" in
    apt-get) "${runner[@]}" apt-get install -y "$pkg" ;;
    dnf|yum) "${runner[@]}" "$PKG_MGR" install -y "$pkg" ;;
    zypper) "${runner[@]}" zypper install -y "$pkg" ;;
    pacman) "${runner[@]}" pacman -S --noconfirm "$pkg" ;;
    *) return 1 ;;
  esac
}

pkg_update() {
  local runner=()
  if ! is_root; then
    if command_exists sudo; then
      runner=(sudo)
    else
      return 1
    fi
  fi
  case "$PKG_MGR" in
    apt-get) "${runner[@]}" apt-get update -y ;;
    dnf) "${runner[@]}" dnf check-update || true ;;
    yum) true ;;
    zypper) "${runner[@]}" zypper refresh ;;
    pacman) "${runner[@]}" pacman -Sy --noconfirm ;;
    *) return 1 ;;
  esac
}

ensure_default_config() {
  local generated_dir="$ROOT/.cody/generated"
  local default_model_file="$generated_dir/cody.json"
  mkdir -p "$generated_dir"
  if [ -f "$default_model_file" ]; then
    if grep -q '"model": "cody/deepseek-v4-flash-free"' "$default_model_file" && grep -q '"DeepSeek V4 Flash Free"' "$default_model_file"; then
      cat > "$default_model_file" << 'CONFIGEOF'
{
  "$schema": "https://cody.dev/config.json",
  "model": "opencode/big-pickle"
}
CONFIGEOF
      ok "Migrated default model to opencode/big-pickle (Sandra Pickle)"
      return 0
    fi
    ok "Default model config already exists."
    return 0
  fi
  cat > "$default_model_file" << 'CONFIGEOF'
{
  "$schema": "https://cody.dev/config.json",
  "model": "opencode/big-pickle"
}
CONFIGEOF
  ok "Default model configured: opencode/big-pickle (Sandra Pickle)"
}

ensure_jq_for_scan() {
  if command_exists jq; then
    return 0
  fi
  warn "jq not found; local model discovery needs jq."
  if [ "$(uname -s)" = "Darwin" ] && command_exists brew; then
    step "Installing jq with Homebrew..."
    brew install jq || return 1
    return 0
  fi
  if [ -n "$PKG_MGR" ]; then
    pkg_update 2>/dev/null || true
    step "Installing jq..."
    pkg_install jq || return 1
    return 0
  fi
  return 1
}

detect_environment() {
  # Check if running inside a container (LXC, Docker, etc.)
  if [ -f /run/.containerenv ] || [ -f /.dockerenv ]; then
    IS_CONTAINER=1
    IS_SERVER=1
    return
  fi
  if command_exists systemd-detect-virt; then
    local virt
    virt=$(systemd-detect-virt -c 2>/dev/null || true)
    if [ -n "$virt" ] && [ "$virt" != "none" ]; then
      IS_CONTAINER=1
      IS_SERVER=1
      return
    fi
  fi
  # Check for /proc/1/env (LXC)
  if grep -q lxc /proc/1/environ 2>/dev/null || grep -q container=lxc /proc/1/environ 2>/dev/null; then
    IS_CONTAINER=1
    IS_SERVER=1
    return
  fi
  # Detect headless server (no display, no desktop)
  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && ! command_exists xdg-open 2>/dev/null; then
    IS_SERVER=1
  fi
}

retry() {
  local label="$1" max=3 backoff=1
  shift
  for i in $(seq 1 $max); do
    if "$@" 2>&1; then return 0; fi
    if [ "$i" -eq "$max" ]; then
      err "$label failed after $max attempts."
      return 1
    fi
    warn "$label failed (attempt $i/$max). Retrying in ${backoff}s..."
    sleep "$backoff"
    backoff=$((backoff * 2))
    [ "$backoff" -gt 16 ] && backoff=16
  done
}

systemd_unit_dir() {
  if is_root; then
    echo "/etc/systemd/system"
  else
    mkdir -p "$HOME/.config/systemd/user"
    echo "$HOME/.config/systemd/user"
  fi
}

systemctl_cmd() {
  if is_root; then
    echo "systemctl"
  else
    echo "systemctl --user"
  fi
}

# ── Banner ─────────────────────────────────────────────────────────────

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║        codyx Unix Installer           ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

detect_environment
detect_pkg_manager

if [ "$IS_SERVER" = "1" ]; then
  if [ "$IS_CONTAINER" = "1" ]; then
    step "Detected container environment (LXC/Docker)"
  else
    step "Detected server environment (headless Linux)"
  fi
  # Default server-friendly settings
  [ "$NO_BUILD" != "1" ] && NO_BUILD=1 && warn "Skipping web UI build (no browser in server)"
  [ "$NO_SCAN" != "1" ] && NO_SCAN=1 && warn "Skipping model scan (server environment)"
fi

# ── Phase 1: Prerequisites ─────────────────────────────────────────────

step "Checking prerequisites..."

if ! command_exists git; then
  if [ -n "$PKG_MGR" ] && (is_root || command_exists sudo); then
    step "Git not found. Installing..."
    pkg_update 2>/dev/null || true
    pkg_install git || { err "Failed to install git"; exit 1; }
    ok "Git installed."
  else
    err "Git is required. Install it with your package manager:"
    err "  apt: sudo apt install git"
    err "  dnf: sudo dnf install git"
    err "  brew: brew install git"
    exit 1
  fi
fi
ok "Git found."

if ! command_exists bun || ! bun_version_supported "$(bun --version 2>/dev/null || echo 0.0.0)"; then
  if command_exists bun; then
    warn "Bun 1.3.13 or newer is required. Updating..."
  else
    step "Bun not found. Installing..."
  fi
  # bun install script needs unzip
  if [ -n "$PKG_MGR" ] && (is_root || command_exists sudo); then
    pkg_install unzip 2>/dev/null || true
  fi
  if command_exists curl; then
    curl -fsSL https://bun.sh/install | bash
  elif command_exists wget; then
    wget -qO- https://bun.sh/install | bash
  else
    err "Need curl or wget to install bun. Install one of them first."
    exit 1
  fi
  if [ -f "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  if ! command_exists bun || ! bun_version_supported "$(bun --version 2>/dev/null || echo 0.0.0)"; then
    err "Bun 1.3.13+ installation failed. Install manually: https://bun.sh"
    exit 1
  fi
  ok "Bun 1.3.13+ installed."
else
  ok "Bun 1.3.13+ found."
fi

# ── Phase 1b: Desktop cloudflared check ────────────────────────────────

if [ "$NO_PROXY" != "1" ] && [ "$IS_SERVER" != "1" ]; then
  if ! command_exists cloudflared; then
    warn "cloudflared not found. Proxy tunnel won't be available."
    warn "Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/"
  else
    ok "cloudflared found."
  fi
fi

# ── Phase 2: Clone or update ───────────────────────────────────────────

step "Setting up codyx checkout..."

if [ -d "$ROOT/.git" ]; then
  ok "Existing checkout found at $ROOT"
  cd "$ROOT"
  current_branch=$(git branch --show-current 2>/dev/null || echo "")
  if [ -n "$current_branch" ] && [ "$current_branch" != "$BRANCH" ]; then
    step "Switching to branch $BRANCH..."
    retry "git fetch" git fetch origin "$BRANCH" --quiet
    git switch "$BRANCH"
  fi
  retry "git pull" git pull --ff-only
  ok "Repository up to date."
elif [ -d "$ROOT" ]; then
  err "Directory $ROOT exists but is not a codyx checkout."
  err "Move it away or remove it, then rerun."
  exit 1
else
  step "Cloning codyx (branch: $BRANCH)..."
  mkdir -p "$(dirname "$ROOT")"
  retry "git clone" git clone --branch "$BRANCH" "$REPO_URL" "$ROOT"
  git config --global --add safe.directory "$ROOT" 2>/dev/null || true
  ok "Cloned to $ROOT"
  cd "$ROOT"
fi

cd "$ROOT"

# ── Phase 3: Dependencies ──────────────────────────────────────────────

step "Installing dependencies..."
retry "bun install" bun install
ok "Dependencies installed."

# ── Phase 4: Web UI ────────────────────────────────────────────────────

if [ "$NO_BUILD" != "1" ]; then
  step "Building web UI..."
  if cd packages/app && bun run build 2>/dev/null; then
    ok "Web UI built."
    cd "$ROOT"
  else
    cd "$ROOT"
    warn "Web UI build failed. Server will proxy to app.cody.ai."
  fi
fi

# ── Phase 5: Proxy (server/CT only) ────────────────────────────────────

install_cloudflared() {
  if command_exists cloudflared; then
    ok "cloudflared already installed."
    return 0
  fi
  step "Installing cloudflared..."
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64)  arch="amd64" ;;
    aarch64) arch="arm64" ;;
    armv7l)  arch="arm" ;;
    *)       warn "Unsupported arch: $arch for cloudflared"; return 1 ;;
  esac
  local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}"
  if command_exists curl; then
    curl -fsSL "$url" -o /usr/local/bin/cloudflared
  elif command_exists wget; then
    wget -q "$url" -O /usr/local/bin/cloudflared
  else
    err "Need curl or wget to download cloudflared"
    return 1
  fi
  chmod +x /usr/local/bin/cloudflared
  if command_exists cloudflared; then
    ok "cloudflared installed ($(cloudflared version 2>/dev/null | head -1))"
    return 0
  fi
  return 1
}

install_tinyproxy() {
  if command_exists tinyproxy; then
    ok "tinyproxy already installed."
    return 0
  fi
  if [ -z "$PKG_MGR" ]; then
    warn "No package manager found. Install tinyproxy manually."
    return 1
  fi
  step "Installing tinyproxy..."
  pkg_install tinyproxy || { warn "Failed to install tinyproxy"; return 1; }
  ok "tinyproxy installed."
}

configure_tinyproxy() {
  if [ -f /etc/tinyproxy/tinyproxy.conf ] && grep -q "^Port $PROXY_PORT" /etc/tinyproxy/tinyproxy.conf 2>/dev/null; then
    ok "tinyproxy already configured for port $PROXY_PORT."
    return 0
  fi
  step "Configuring tinyproxy on port $PROXY_PORT..."
  local conf="/etc/tinyproxy/tinyproxy.conf"
  if [ -f "$conf" ]; then
    cp "$conf" "${conf}.bak.$(date +%s)"
  fi
  cat > "$conf" << TINYPROXYEOF
Port $PROXY_PORT
Listen 127.0.0.1
Timeout 600
DefaultErrorFile "/usr/share/tinyproxy/default.html"
StatFile "/usr/share/tinyproxy/stats.html"
Logfile "/var/log/tinyproxy/tinyproxy.log"
LogLevel Info
PidFile "/var/run/tinyproxy/tinyproxy.pid"
MaxClients 100
MinSpareServers 5
MaxSpareServers 20
StartServers 10
MaxRequestsPerChild 0
ViaProxyName "codyx"
Allow 127.0.0.1
Allow ::1
TINYPROXYEOF
  ok "tinyproxy configured (port $PROXY_PORT, localhost only)."
}

install_tor() {
  if command_exists tor; then
    ok "tor already installed."
    return 0
  fi
  if [ -z "$PKG_MGR" ]; then
    warn "No package manager found. Install tor manually."
    return 1
  fi
  step "Installing tor..."
  pkg_install tor || { warn "Failed to install tor"; return 1; }
  ok "tor installed."
}

configure_tor_hidden_service() {
  local hs_dir="/var/lib/tor/codyx_hidden_service"
  if [ -f /etc/tor/torrc ] && grep -q "codyx_hidden_service" /etc/tor/torrc 2>/dev/null; then
    ok "Tor hidden service already configured."
    local hostname_file="$hs_dir/hostname"
    if [ -f "$hostname_file" ]; then
      ok "Onion address: $(cat "$hostname_file")"
    fi
    return 0
  fi
  step "Configuring Tor hidden service for port $PROXY_PORT..."
  mkdir -p "$hs_dir"
  chmod 700 "$hs_dir"
  cat >> /etc/tor/torrc << TOREOF

# codyx hidden service
HiddenServiceDir $hs_dir
HiddenServicePort $PROXY_PORT 127.0.0.1:$PROXY_PORT
TOREOF
  ok "Tor hidden service configured."
}

setup_proxy_stack() {
  # Only install proxy stack if we're root (needed for system packages)
  if ! is_root; then
    warn "Not running as root — skipping proxy install."
    if [ -n "$CLOUDFLARED_HOSTNAME" ]; then
      warn "After install, run: sudo $0"
    fi
    return 1
  fi

  # Ensure required tools
  if ! command_exists curl && ! command_exists wget; then
    if [ -n "$PKG_MGR" ]; then
      pkg_install curl || true
    fi
  fi

  # cloudflared always
  install_cloudflared || warn "cloudflared setup incomplete"

  if [ -n "$CLOUDFLARED_HOSTNAME" ]; then
    ok "Proxy: cloudflared tunnel to $CLOUDFLARED_HOSTNAME"
  else
    install_tinyproxy && configure_tinyproxy
    install_tor && configure_tor_hidden_service
  fi

  ok "Proxy setup complete."
}

if [ "$NO_PROXY" != "1" ] && [ "$IS_SERVER" = "1" ] && [ -z "$codyproXY_URL" ]; then
  step "Setting up proxy..."
  setup_proxy_stack
elif [ -n "$codyproXY_URL" ]; then
  ok "Using external proxy: $codyproXY_URL"
fi

# ── Phase 6: Proxy env file ────────────────────────────────────────────

if [ "$NO_PROXY" != "1" ]; then
  if [ ! -f "$ROOT/.env.proxy" ]; then
    step "Creating .env.proxy..."
    if [ -n "$codyproXY_URL" ]; then
      # External proxy URL — just use it directly, no local proxy installed
      cat > "$ROOT/.env.proxy" << PROXYEOF
CODY_PROXY_ENABLED=1
HTTPS_PROXY=$codyproXY_URL
HTTP_PROXY=$codyproXY_URL
NO_PROXY=localhost,127.0.0.1,::1,192.168.68.68
PROXYEOF
    elif [ "$IS_SERVER" = "1" ] && ! is_root && [ -z "$CLOUDFLARED_HOSTNAME" ]; then
      # Rootless server (e.g. unprivileged LXC) without external proxy —
      # no local proxy was installed, warn and skip
      warn "Not root — proxy stack not installed. Set codyproXY_URL or run as root."
    elif [ "$IS_SERVER" = "1" ] && [ -n "$CLOUDFLARED_HOSTNAME" ]; then
      # Cloudflare tunnel — cloudflared listens on localhost, forwards
      # through Cloudflare Access to the remote hostname.
      cat > "$ROOT/.env.proxy" << PROXYEOF
CODY_PROXY_ENABLED=1
HTTPS_PROXY=http://localhost:$PROXY_PORT
HTTP_PROXY=http://localhost:$PROXY_PORT
NO_PROXY=localhost,127.0.0.1,::1,192.168.68.68
PROXYEOF
    elif [ "$IS_SERVER" = "1" ]; then
      # Server/LAN — use LAN IP for local proxy stack
      lan_ip=$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || hostname -I 2>/dev/null | awk '{print $1}' || echo "0.0.0.0")
      cat > "$ROOT/.env.proxy" << PROXYEOF
CODY_PROXY_ENABLED=1
HTTPS_PROXY=http://${lan_ip}:$PROXY_PORT
HTTP_PROXY=http://${lan_ip}:$PROXY_PORT
NO_PROXY=localhost,127.0.0.1,::1,192.168.68.68,${lan_ip}
PROXYEOF
    else
      # Desktop/localhost
      cat > "$ROOT/.env.proxy" << PROXYEOF
CODY_PROXY_ENABLED=1
HTTPS_PROXY=http://localhost:$PROXY_PORT
HTTP_PROXY=http://localhost:$PROXY_PORT
NO_PROXY=localhost,127.0.0.1,::1,192.168.68.68
PROXYEOF
    fi
    ok ".env.proxy created."
  else
    ok ".env.proxy already exists."
  fi
fi

# ── Phase 7: Systemd services (server/root only) ───────────────────────

create_cody_service() {
  local unit_dir
  unit_dir=$(systemd_unit_dir)
  local svc="$unit_dir/codyx.service"

  if [ -f "$svc" ]; then
    ok "codyx.service already exists."
    return 0
  fi

  step "Creating codyx systemd service..."

  local env_file_arg=""
  if [ -f "$ROOT/.env.proxy" ]; then
    env_file_arg="EnvironmentFile=$ROOT/.env.proxy"
  fi

  cat > "$svc" << SERVICEEOF
[Unit]
Description=codyx AI coding assistant
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=$(command -v bun) run --cwd $ROOT/packages/codyx --conditions=browser src/index.ts serve --port $CODY_PORT --hostname $CODY_HOST
Restart=always
RestartSec=5
$env_file_arg

[Install]
WantedBy=multi-user.target
SERVICEEOF
  ok "codyx.service created."
}

create_proxy_tunnel_service() {
  if ! command_exists cloudflared; then
    warn "cloudflared not installed — skipping tunnel service."
    return 1
  fi
  if [ -z "${CLOUDFLARED_HOSTNAME:-}" ]; then
    warn "CODY_TUNNEL_HOSTNAME not set — skipping tunnel service."
    warn "Set it later or create the service manually."
    return 1
  fi

  local unit_dir
  unit_dir=$(systemd_unit_dir)
  local svc="$unit_dir/codyx-proxy-tunnel.service"

  if [ -f "$svc" ]; then
    ok "codyx-proxy-tunnel.service already exists."
    return 0
  fi

  step "Creating Cloudflare tunnel systemd service..."

  local cloudflared_bin
  cloudflared_bin=$(command -v cloudflared)

  cat > "$svc" << SERVICEEOF
[Unit]
Description=Cloudflare TCP tunnel for codyx proxy
After=network.target

[Service]
Type=simple
ExecStart=$cloudflared_bin access tcp --hostname $CLOUDFLARED_HOSTNAME --url localhost:$PROXY_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF
  ok "codyx-proxy-tunnel.service created."
}

enable_systemd_services() {
  local cmd
  cmd=$(systemctl_cmd)

  step "Enabling services to start on boot..."

  if [ -f "$(systemd_unit_dir)/codyx.service" ]; then
    $cmd enable codyx.service 2>/dev/null || true
    $cmd start codyx.service 2>/dev/null || warn "codyx.service start delayed (may need reboot)"
    ok "codyx.service enabled."
  fi

  if [ -f "$(systemd_unit_dir)/codyx-proxy-tunnel.service" ]; then
    $cmd enable codyx-proxy-tunnel.service 2>/dev/null || true
    $cmd start codyx-proxy-tunnel.service 2>/dev/null || warn "tunnel service start delayed"
    ok "codyx-proxy-tunnel.service enabled."
  fi

  # Enable tinyproxy (installed by package manager)
  if command_exists tinyproxy; then
    if is_root; then
      systemctl enable tinyproxy 2>/dev/null || true
      systemctl start tinyproxy 2>/dev/null || true
    fi
    ok "tinyproxy service enabled."
  fi

  # Enable tor (installed by package manager)
  if command_exists tor; then
    if is_root; then
      systemctl enable tor 2>/dev/null || true
      systemctl start tor 2>/dev/null || true
    fi
    ok "tor service enabled."
  fi
}

if [ "$IS_SERVER" = "1" ] && is_root; then
  step "Setting up systemd services for auto-start on boot..."
  create_cody_service
  create_proxy_tunnel_service
  enable_systemd_services
fi

# ── Phase 8: Model discovery ───────────────────────────────────────────

if [ "$NO_SCAN" != "1" ] && [ -f "$ROOT/script/discover-local-models.sh" ]; then
  if ! ensure_jq_for_scan; then
    warn "Skipping local model discovery because jq could not be installed."
    NO_SCAN=1
  fi
fi

if [ "$NO_SCAN" != "1" ] && [ -f "$ROOT/script/discover-local-models.sh" ]; then
  if [ "$YES" = "1" ]; then
    step "Running model discovery..."
    bash "$ROOT/script/discover-local-models.sh" --root "$ROOT" --max-seconds 30
    ok "Model discovery complete."
  else
    echo ""
    read -rp "Scan for local Ollama/GGUF models? [y/N] " scan_answer
    if [ "$scan_answer" = "y" ] || [ "$scan_answer" = "Y" ]; then
      bash "$ROOT/script/discover-local-models.sh" --root "$ROOT" --max-seconds 30
      ok "Model discovery complete."
    fi
  fi
fi

ensure_default_config

# ── Phase 9: Health check ──────────────────────────────────────────────

step "Running health check..."
cd "$ROOT/packages/codyx"
version=$(bun run --conditions=browser src/index.ts --version 2>/dev/null || true)
if [ -n "$version" ]; then
  ok "codyx version: $version"
else
  warn "Health check could not start codyx."
fi
cd "$ROOT"

# ── Phase 10: Global command ───────────────────────────────────────────

step "Installing global command..."
GLOBAL_BIN_DIR="${CODY_GLOBAL_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$GLOBAL_BIN_DIR"
write_unix_launcher() {
  local launcher="$1"
  cat > "$launcher" << LAUNCHEREOF
#!/usr/bin/env bash
set -euo pipefail

ROOT="$ROOT"
export CODY_INSTALL_ROOT="\${CODY_INSTALL_ROOT:-\$ROOT}"
BUN="\$(command -v bun || true)"
if [ -z "\$BUN" ] && [ -x "\$HOME/.bun/bin/bun" ]; then
  BUN="\$HOME/.bun/bin/bun"
fi
if [ -z "\$BUN" ]; then
  echo "Bun was not found. Re-run the codyx installer or install Bun from https://bun.sh." >&2
  exit 1
fi

export XDG_DATA_HOME="\${XDG_DATA_HOME:-\$HOME/.local/share/codyx}"
export XDG_CACHE_HOME="\${XDG_CACHE_HOME:-\$HOME/.cache/codyx}"
export XDG_CONFIG_HOME="\${XDG_CONFIG_HOME:-\$HOME/.config/codyx}"
export XDG_STATE_HOME="\${XDG_STATE_HOME:-\$HOME/.local/state/codyx}"
export CODY_DB="\${CODY_DB:-codyx.db}"
export CODY_CONFIG_DIR="\${CODY_CONFIG_DIR:-\$ROOT/.cody/generated}"

if [ -f "\$ROOT/.env.proxy" ]; then
  set -a
  . "\$ROOT/.env.proxy"
  set +a
fi

exec "\$BUN" run --cwd "\$ROOT/packages/codyx" --conditions=browser src/index.ts "\$@"
LAUNCHEREOF
  chmod +x "$launcher"
}

write_unix_launcher "$GLOBAL_BIN_DIR/codyx"
ok "Global launcher written to $GLOBAL_BIN_DIR/codyx"

export PATH="$GLOBAL_BIN_DIR:$PATH"

if ! grep -qs "$GLOBAL_BIN_DIR" "$HOME/.profile" "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.bashrc" \
  "${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" 2>/dev/null; then
  case "${SHELL:-}" in
    *fish*)
      shell_config="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
      mkdir -p "$(dirname "$shell_config")"
      touch "$shell_config"
      {
        echo ""
        echo "# >>> codyx installer >>>"
        echo "fish_add_path \"$GLOBAL_BIN_DIR\""
        echo "# <<< codyx installer <<<"
      } >> "$shell_config"
      ;;
    *zsh*)
      shell_config="${ZDOTDIR:-$HOME}/.zshrc"
      mkdir -p "$(dirname "$shell_config")"
      touch "$shell_config"
      {
        echo ""
        echo "# >>> codyx installer >>>"
        echo "export PATH=\"$GLOBAL_BIN_DIR:\$PATH\""
        echo "# <<< codyx installer <<<"
      } >> "$shell_config"
      ;;
    *)
      shell_config="$HOME/.profile"
      touch "$shell_config"
      {
        echo ""
        echo "# >>> codyx installer >>>"
        echo "export PATH=\"$GLOBAL_BIN_DIR:\$PATH\""
        echo "# <<< codyx installer <<<"
      } >> "$shell_config"
      ;;
  esac
  ok "Added codyx to PATH in $shell_config"
fi

version=$("$GLOBAL_BIN_DIR/codyx" --version 2>/dev/null || true)
if [ -z "$version" ]; then
  err "The global codyx command could not start."
  exit 1
fi
ok "Global command verified: codyx $version"

# ── Show onion address if available ────────────────────────────────────

if [ "$IS_SERVER" = "1" ] && [ -f /var/lib/tor/codyx_hidden_service/hostname ]; then
  onion=$(cat /var/lib/tor/codyx_hidden_service/hostname 2>/dev/null || true)
  if [ -n "$onion" ]; then
    ok "Tor onion address: $onion"
  fi
fi

# ── Reboot prompt for server/CT ────────────────────────────────────────

if [ "$IS_SERVER" = "1" ] && is_root; then
  echo ""
  if [ "$IS_CONTAINER" = "1" ]; then
    step "Installation complete inside container. Starting services..."
    systemctl start codyx.service 2>/dev/null || warn "codyx.service failed to start"
    if [ -f "$(systemd_unit_dir)/codyx-proxy-tunnel.service" ]; then
      systemctl start codyx-proxy-tunnel.service 2>/dev/null || warn "tunnel service failed to start"
    fi
  elif [ "$YES" = "1" ] && [ "$REBOOT" = "1" ]; then
    step "Installation complete. Rebooting in 10 seconds..."
    sleep 10
    reboot
  elif [ "$YES" = "1" ]; then
    step "Services are configured. Reboot later, or set CODY_REBOOT=1 to reboot automatically."
  else
    echo ""
    echo -e "${CYAN}>>${NC} Installation complete."
    echo -e "${CYAN}>>${NC} Services have been configured to start on boot."
    echo ""
    read -rp "Reboot now to start all services? [y/N] " reboot_answer
    if [ "$reboot_answer" = "y" ] || [ "$reboot_answer" = "Y" ]; then
      step "Rebooting..."
      reboot
    else
      echo ""
      step "You can start services manually, or reboot later."
      echo "  systemctl start codyx"
      if [ -f "$(systemd_unit_dir)/codyx-proxy-tunnel.service" ]; then
        echo "  systemctl start codyx-proxy-tunnel"
      fi
      if command_exists tinyproxy; then
        echo "  systemctl start tinyproxy"
      fi
      if command_exists tor; then
        echo "  systemctl start tor"
      fi
    fi
  fi
fi

# ── Done ───────────────────────────────────────────────────────────────

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   codyx installed successfully!      ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
echo "  Installed to:  $ROOT"
echo "  Global command: codyx"
echo ""

if [ "$IS_SERVER" = "1" ]; then
  echo "  Next steps (server):"
  echo "    codyx serve   Start the AI coding server"
  if command_exists cloudflared; then
    echo "    cloudflared access tcp --hostname <your-hostname> --url localhost:$PROXY_PORT"
  fi
  if [ -f /var/lib/tor/codyx_hidden_service/hostname ]; then
    echo "    Onion address: $(cat /var/lib/tor/codyx_hidden_service/hostname 2>/dev/null || echo 'pending')"
  fi
else
  echo "  Next steps:"
  echo "    codyx           Launch interactive menu (TUI)"
  echo "    codyx web       Start web UI in browser"
fi
echo "    codyx --help    See all commands"
echo "    codyx doctor    Run diagnostics"
echo ""
