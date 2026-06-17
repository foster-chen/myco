#!/usr/bin/env bash
# Deploy myco to a remote machine as a bare-metal Node.js process (no Docker).
#
# Designed for WSL2 / Linux targets where agent sessions need full host tool
# access.  All installs are user-level (no sudo required).
#
# Usage:
#   ./scripts/remote-deploy.sh                                  # full deploy with defaults
#   ./scripts/remote-deploy.sh --skip-deps                      # skip dependency installation
#   ./scripts/remote-deploy.sh --dry-run                        # plan only; no changes on remote
#   ./scripts/remote-deploy.sh --redeploy                       # update code + restart (skip steps 1-6)
#   MYCO_REMOTE_SSH=user@host -p 2222 ./scripts/remote-deploy.sh
#   MYCO_REMOTE_USER=myuser MYCO_REMOTE_HOST=10.0.0.1 \
#     MYCO_REMOTE_PORT=22 ./scripts/remote-deploy.sh
#
# Override knobs (env vars or flags):
#   MYCO_REMOTE_USER     Remote SSH user               (default: optix)
#   MYCO_REMOTE_HOST     Remote SSH host               (default: 100.120.240.8)
#   MYCO_REMOTE_PORT     Remote SSH port               (default: 2222)
#   MYCO_REMOTE_REPO     Repo location on remote       (default: ~/myco)
#   MYCO_STATE_DIR       State dir on remote           (default: ~/myco-state)
#   MYCO_REMOTE_LISTEN   Host:port for the server      (default: 0.0.0.0:3000)
#   MYCO_NODE_VERSION    Node.js major version         (default: 20)
#   MYCO_SERVICE_NAME    systemd service name          (default: mycod)
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

# ─── config ──────────────────────────────────────────────────────────────────
REMOTE_USER="${MYCO_REMOTE_USER:-optix}"
REMOTE_HOST="${MYCO_REMOTE_HOST:-100.120.240.8}"
REMOTE_PORT="${MYCO_REMOTE_PORT:-2222}"
REMOTE_REPO="${MYCO_REMOTE_REPO:-\${HOME}/myco}"
STATE_DIR="${MYCO_STATE_DIR:-\${HOME}/myco-state}"
LISTEN="${MYCO_REMOTE_LISTEN:-0.0.0.0:3000}"
NODE_VER="${MYCO_NODE_VERSION:-20}"
SERVICE_NAME="${MYCO_SERVICE_NAME:-mycod}"

SKIP_DEPS=0
DRY_RUN=0
REDEPLOY=0
ENV_OVERWRITE=""

LISTEN_HOST="${LISTEN%%:*}"
LISTEN_PORT="${LISTEN##*:}"

# ─── helpers ─────────────────────────────────────────────────────────────────
ssh_remote() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 -p "$REMOTE_PORT" "${REMOTE_USER}@${REMOTE_HOST}" "$@"
}

scp_remote() {
  scp -o BatchMode=yes -o ConnectTimeout=10 -P "$REMOTE_PORT" "$@"
}

info()  { printf '\033[1;34m[remote_deploy]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[remote_deploy]\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31m[remote_deploy FATAL]\033[0m %s\n' "$*" >&2; exit 1; }

nvm_prefix() {
  printf 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && export PATH="$HOME/.local/bin:$PATH"'
}

xdg_prefix() {
  printf 'export XDG_RUNTIME_DIR=/run/user/$(id -u) && mkdir -p "$XDG_RUNTIME_DIR"'
}

# ─── arg parsing ─────────────────────────────────────────────────────────────
usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \?//'
  cat <<FLAGS

Flags:
  --skip-deps     Skip dependency installation (step 2)
  --dry-run       Print plan and exit; no changes on remote
  --redeploy      Update code + restart only (skip steps 1-6)
  --env-overwrite <path>
                  Overwrite remote .env with the given local file.
                  Without this flag the remote .env is never touched.
  --help          Show this help

Environment variables:
  MYCO_REMOTE_USER   Remote SSH user          (default: optix)
  MYCO_REMOTE_HOST   Remote SSH host          (default: 100.120.240.8)
  MYCO_REMOTE_PORT   Remote SSH port          (default: 2222)
  MYCO_REMOTE_REPO   Repo location on remote  (default: ~/myco)
  MYCO_STATE_DIR     State dir on remote      (default: ~/myco-state)
  MYCO_REMOTE_LISTEN Host:port for server     (default: 0.0.0.0:3000)
  MYCO_NODE_VERSION  Node.js major version    (default: 20)
  MYCO_SERVICE_NAME  systemd service name     (default: mycod)
FLAGS
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-deps)   SKIP_DEPS=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --redeploy)    REDEPLOY=1; shift ;;
    --env-overwrite)
      [[ $# -lt 2 ]] && die "--env-overwrite requires a path argument"
      ENV_OVERWRITE="$2"; shift 2 ;;
    --help|-h)     usage ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ─── pre-flight ──────────────────────────────────────────────────────────────
info "Remote: ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PORT}"
info "State dir: ${STATE_DIR}"
info "Listen: ${LISTEN_HOST}:${LISTEN_PORT}"
info "Node version: ${NODE_VER}"
info "Service: ${SERVICE_NAME}.service"

if [[ $DRY_RUN -eq 1 ]]; then
  info "DRY RUN — no changes will be made"
fi

# ─── step 1: check SSH connectivity + environment ───────────────────────────
step_check_ssh() {
  info "Step 1: Checking SSH connectivity + environment ..."
  if ! ssh_remote 'echo ok' >/dev/null 2>&1; then
    die "Cannot SSH to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PORT}. Check connectivity and key auth."
  fi
  info "SSH connection OK"
  ssh_remote 'uname -a; cat /etc/os-release 2>/dev/null | head -5; which node git bash curl 2>/dev/null; node --version 2>/dev/null; df -h /; free -h 2>/dev/null || true; systemctl --version 2>/dev/null || echo "no systemd"'
}

# ─── step 2: install runtime dependencies ────────────────────────────────────
step_install_deps() {
  info "Step 2: Installing runtime dependencies ..."

  info "  Installing nvm + Node.js ${NODE_VER} ..."
  ssh_remote "$(nvm_prefix) || curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  ssh_remote "$(nvm_prefix) && nvm install ${NODE_VER}"

  info "  Installing Caddy ..."
  ssh_remote 'mkdir -p ~/.local/bin && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o ~/.local/bin/caddy && chmod +x ~/.local/bin/caddy'

  info "  Installing Claude Code CLI ..."
  ssh_remote "$(nvm_prefix) && npm install -g @anthropic-ai/claude-code"

  info "  Installing lean-ctx ..."
  ssh_remote 'mkdir -p ~/.local/lib/lean-ctx && curl -fsSL "https://github.com/yvgude/lean-ctx/releases/download/v3.6.14/lean-ctx-x86_64-unknown-linux-musl.tar.gz" | tar -xz -C ~/.local/lib/lean-ctx && chmod +x ~/.local/lib/lean-ctx/lean-ctx && ln -sf ~/.local/lib/lean-ctx/lean-ctx ~/.local/bin/lean-ctx'

  info "  Ensuring ~/.local/bin in PATH ..."
  ssh_remote 'grep -q ".local/bin" ~/.bashrc || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc'

  info "Step 2 done"
}

# ─── step 3: transfer repo to remote ─────────────────────────────────────────
step_transfer_repo() {
  info "Step 3: Transferring repo to remote ..."
  local tmp_archive
  tmp_archive=$(mktemp /tmp/myco-src.XXXXXX.tgz)
  git archive HEAD -o "$tmp_archive"
  info "  Archive created ($(du -h "$tmp_archive" | cut -f1))"
  scp_remote "$tmp_archive" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/myco-src.tgz"
  rm -f "$tmp_archive"
  ssh_remote "mkdir -p ~/myco && tar -xzf /tmp/myco-src.tgz -C ~/myco"
  info "Step 3 done"
}

# ─── step 4: install npm dependencies ────────────────────────────────────────
step_npm_install() {
  info "Step 4: Installing npm dependencies ..."
  ssh_remote "$(nvm_prefix) && cd ~/myco/server && npm install"
  info "Step 4 done"
}

# ─── step 5: create state directory structure ────────────────────────────────
step_create_state_dir() {
  info "Step 5: Creating state directory structure ..."
  ssh_remote "STATE_DIR=${STATE_DIR} && \
    mkdir -p \"\$STATE_DIR\" \"\$STATE_DIR/home\" \"\$STATE_DIR/wks\" \"\$STATE_DIR/home/.claude\" \"\$STATE_DIR/caddy\" && \
    [ -f \"\$STATE_DIR/sessions.json\" ] || echo '{}' > \"\$STATE_DIR/sessions.json\" && \
    chmod 600 \"\$STATE_DIR/sessions.json\" && \
    [ -f \"\$STATE_DIR/allowed-github-users.txt\" ] || printf '# GitHub logins allowed to sign in to myco. One per line. # starts a comment.\n' > \"\$STATE_DIR/allowed-github-users.txt\""
  info "Step 5 done"
}

# ─── step 6: create systemd user service ─────────────────────────────────────
step_create_service() {
  info "Step 6: Creating systemd user service ..."

  local node_bin_path
  node_bin_path=$(ssh_remote "$(nvm_prefix) && which node" | tr -d '\r\n')
  if [[ -z "$node_bin_path" ]]; then
    die "Could not determine Node.js binary path on remote"
  fi
  info "  Node binary: ${node_bin_path}"

  local nvm_node_dir
  nvm_node_dir=$(dirname "$node_bin_path")

  local expanded_state_dir
  expanded_state_dir=$(ssh_remote "echo ${STATE_DIR}" | tr -d '\r\n')

  local expanded_home
  expanded_home=$(ssh_remote 'echo $HOME' | tr -d '\r\n')

  local expanded_repo
  expanded_repo=$(ssh_remote "echo ${REMOTE_REPO}" | tr -d '\r\n')

  ssh_remote "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/${SERVICE_NAME}.service << 'SERVICE'
[Unit]
Description=myco daemon (Node.js agent-session server)
After=network-online.target

[Service]
Type=simple
Environment=MYCO_STATE_DIR=${expanded_state_dir}
Environment=MYCO_WORKSPACE=${expanded_state_dir}/wks
Environment=HOST=${LISTEN_HOST}
Environment=PORT=${LISTEN_PORT}
Environment=PATH=${nvm_node_dir}:${expanded_home}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=SHELL=/bin/bash
Environment=HOME=${expanded_home}
WorkingDirectory=${expanded_repo}
ExecStart=${node_bin_path} ${expanded_repo}/server/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SERVICE"

  info "Step 6 done"
}

# ─── step 7: start and verify ────────────────────────────────────────────────
step_start_verify() {
  info "Step 7: Starting and verifying ..."
  ssh_remote "$(xdg_prefix) && \
    systemctl --user daemon-reload && \
    systemctl --user enable ${SERVICE_NAME}.service && \
    systemctl --user start ${SERVICE_NAME}.service && \
    loginctl enable-linger ${REMOTE_USER} && \
    sleep 3 && systemctl --user status ${SERVICE_NAME}.service"

  info "  Checking HTTP response ..."
  local http_code
  http_code=$(ssh_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:${LISTEN_PORT}/" 2>/dev/null || true)
  if [[ "$http_code" == "200" ]]; then
    info "  Server responding (HTTP ${http_code})"
  else
    warn "  Server returned HTTP ${http_code:-<no response>} — may need more time or config"
  fi

  info "Step 7 done"
}

# ─── push .env to remote (only when --env-overwrite is set) ───────────────────
step_push_env() {
  info "Pushing .env to remote ..."
  if [[ ! -f "$ENV_OVERWRITE" ]]; then
    die "--env-overwrite file not found: ${ENV_OVERWRITE}"
  fi
  local expanded_state_dir
  expanded_state_dir=$(ssh_remote "echo ${STATE_DIR}" | tr -d '\r\n')
  scp_remote "$ENV_OVERWRITE" "${REMOTE_USER}@${REMOTE_HOST}:${expanded_state_dir}/.env"
  ssh_remote "chmod 600 ${expanded_state_dir}/.env"
  info "  Remote .env overwritten from ${ENV_OVERWRITE}"
}

# ─── redeploy: update code + restart ─────────────────────────────────────────
do_redeploy() {
  info "Redeploying (update code + restart) ..."

  info "  Creating archive from HEAD ..."
  local tmp_archive
  tmp_archive=$(mktemp /tmp/myco-src.XXXXXX.tgz)
  git archive HEAD -o "$tmp_archive"
  info "  Archive created ($(du -h "$tmp_archive" | cut -f1))"

  info "  Transferring archive to remote ..."
  scp_remote "$tmp_archive" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/myco-src.tgz"
  rm -f "$tmp_archive"

  info "  Extracting archive + installing dependencies on remote ..."
  ssh_remote "$(nvm_prefix) && tar -xzf /tmp/myco-src.tgz -C ~/myco && \
    cd ~/myco/server && npm install"

  if [[ -n "$ENV_OVERWRITE" ]]; then
    step_push_env
  fi

  info "  Restarting service ..."
  ssh_remote "$(xdg_prefix) && systemctl --user restart ${SERVICE_NAME}.service"

  info "  Waiting for service to come up ..."
  sleep 3

  info "  Verifying service status ..."
  ssh_remote "$(xdg_prefix) && systemctl --user status ${SERVICE_NAME}.service 2>&1 | head -8"

  info "  Checking HTTP response ..."
  local http_code
  http_code=$(ssh_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:${LISTEN_PORT}/" 2>/dev/null || true)
  if [[ "$http_code" == "200" ]]; then
    info "  Server responding (HTTP ${http_code})"
  else
    warn "  Server returned HTTP ${http_code:-<no response>} — may need more time or config"
  fi

  info "Redeploy complete"
}

# ─── main ────────────────────────────────────────────────────────────────────
main() {
  if [[ $DRY_RUN -eq 1 ]]; then
    step_check_ssh
    info "Dry run complete — no changes made"
    exit 0
  fi

  if [[ $REDEPLOY -eq 1 ]]; then
    do_redeploy
    exit 0
  fi

  step_check_ssh

  if [[ $SKIP_DEPS -eq 0 ]]; then
    step_install_deps
  else
    info "Step 2: Skipping dependency installation (--skip-deps)"
  fi

  step_transfer_repo
  step_npm_install
  step_create_state_dir

  if [[ -n "$ENV_OVERWRITE" ]]; then
    step_push_env
  fi

  step_create_service
  step_start_verify

  cat <<POST

──────────────────────────────────────────────────
  Deploy complete!
──────────────────────────────────────────────────
  Service:   ${SERVICE_NAME}.service (systemd --user)
  Listen:    ${LISTEN_HOST}:${LISTEN_PORT}
  State dir: ${STATE_DIR}
  Repo:      ${REMOTE_REPO}

  Next steps:
    1. Configure ${STATE_DIR}/.env (or re-run with --env-overwrite <path>):
         MYCO_GH_CLIENT_ID=<id>
         MYCO_GH_CLIENT_SECRET=<secret>
         MYCO_PUBLIC_ORIGIN=http://<tailscale-ip>:${LISTEN_PORT}
    2. Add GitHub logins to ${STATE_DIR}/allowed-github-users.txt
    3. Add ANTHROPIC_API_KEY=sk-ant-... to ${STATE_DIR}/.env
    4. Set up port forwarding (PowerShell/Tailscale) if needed
    5. Restart after .env changes:
         ssh -p ${REMOTE_PORT} ${REMOTE_USER}@${REMOTE_HOST} \\
           '$(xdg_prefix) && systemctl --user restart ${SERVICE_NAME}'

  Useful commands:
    systemctl --user status ${SERVICE_NAME}     # check status
    journalctl --user -u ${SERVICE_NAME} -f     # live logs
    ./scripts/remote-deploy.sh --redeploy       # update + restart
──────────────────────────────────────────────────
POST
}

main
