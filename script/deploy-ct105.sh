#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${CODY_DEPLOY_REPO_DIR:-/opt/cody-orchestra}"
SERVICE_NAME="${CODY_DEPLOY_SERVICE:-cody-orchestra.service}"
BRANCH="${CODY_DEPLOY_BRANCH:-master}"
REMOTE="${CODY_DEPLOY_REMOTE:-origin}"
TARGET_SHA="${CODY_DEPLOY_SHA:-${GITHUB_SHA:-}}"
LOG_FILE="${CODY_DEPLOY_LOG:-/var/log/cody-orchestra-deploy.log}"
LOCK_FILE="${CODY_DEPLOY_LOCK:-/tmp/cody-orchestra-deploy.lock}"
BUN_BIN="${BUN_BIN:-/root/.bun/bin/bun}"

mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "== cody-orchestra deploy $(date -Is) =="
echo "repo=$REPO_DIR service=$SERVICE_NAME branch=$BRANCH sha=${TARGET_SHA:-latest}"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Deploy repo not found: $REPO_DIR" >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another deploy is already running; exiting."
  exit 0
fi

cd "$REPO_DIR"

PREVIOUS_SHA="$(git rev-parse HEAD)"
ROLLED_FORWARD=0

rollback() {
  local status=$?
  if [[ "$status" -ne 0 && "$ROLLED_FORWARD" -eq 1 ]]; then
    echo "Deploy failed with status $status; rolling back to $PREVIOUS_SHA"
    git reset --hard "$PREVIOUS_SHA" || true
    "$BUN_BIN" install --frozen-lockfile || true
    "$BUN_BIN" run --cwd packages/app build || true
    systemctl restart "$SERVICE_NAME" || true
  fi
  echo "== deploy finished status=$status $(date -Is) =="
  exit "$status"
}
trap rollback EXIT

git fetch --prune "$REMOTE" "$BRANCH"

if [[ -z "$TARGET_SHA" ]]; then
  TARGET_SHA="$(git rev-parse "$REMOTE/$BRANCH")"
fi

git cat-file -e "$TARGET_SHA^{commit}"

STATUS="$(git status --porcelain --untracked-files=no)"
if [[ -n "$STATUS" ]]; then
  HEAD_HASH="$(git rev-parse HEAD:packages/codyx/bin/codyx 2>/dev/null || true)"
  WORKTREE_HASH="$(git hash-object packages/codyx/bin/codyx 2>/dev/null || true)"
  TARGET_MODE="$(git ls-tree "$TARGET_SHA" packages/codyx/bin/codyx | awk '{print $1}')"

  if [[ "$STATUS" == " M packages/codyx/bin/codyx" && -n "$HEAD_HASH" && "$HEAD_HASH" == "$WORKTREE_HASH" && "$TARGET_MODE" == "100755" ]]; then
    echo "Self-healing codyx bin executable-bit drift before deploy."
    git reset --hard "$TARGET_SHA"
    ROLLED_FORWARD=1
  else
    echo "Tracked local changes exist in $REPO_DIR; refusing to deploy automatically." >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
fi

git checkout "$BRANCH"

CURRENT_SHA="$(git rev-parse HEAD)"
if [[ "$CURRENT_SHA" == "$TARGET_SHA" ]]; then
  echo "Already at $TARGET_SHA"
else
  git merge --ff-only "$TARGET_SHA"
  ROLLED_FORWARD=1
fi

"$BUN_BIN" install --frozen-lockfile
"$BUN_BIN" run --cwd packages/app build
systemctl restart "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME"

echo "Deployed $(git rev-parse --short HEAD) successfully."
