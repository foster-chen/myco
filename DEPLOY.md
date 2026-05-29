# Deploying Myco

## Prerequisites

Before deploying, ensure you have:

1. **Docker** installed and running on the build machine and the target host.
2. **SSH access** to the remote host (for remote deploys), or Docker on localhost (for local deploys).
3. **The myco repo** cloned and `./test/test.sh` passing locally.
4. **Node.js 20+** + `npm` (for rebuilding the vendored agent-sdk if you modify it).

## @opencode-ai/agent-sdk Vendoring

Non-Anthropic providers (Alibaba-CN, ZhipuAI, etc.) use `@opencode-ai/agent-sdk`, which is vendored into `server/vendor/agent-sdk/`. The vendored package includes pre-built `dist/` files and its own `node_modules/` with `ai` (Vercel AI SDK v6), `@ai-sdk/anthropic`, and `@ai-sdk/openai-compatible`.

### How it works

- `server/package.json` declares `"@opencode-ai/agent-sdk": "file:vendor/agent-sdk"` — npm resolves this as a local path dependency.
- `npm ci` in the Dockerfile copies `server/vendor/` first, then installs, so the agent-sdk and its subdeps are available at runtime.
- `.dockerignore` excludes `server/vendor/agent-sdk/node_modules/` from the build context (they're reinstalled during `npm ci`).

### Rebuilding the vendored agent-sdk from opencode source

If you need to update `@opencode-ai/agent-sdk` (e.g. a new provider or bug fix), rebuild it from the opencode repo:

```bash
# 1. In the opencode repo, build the agent-sdk package:
cd /path/to/opencode/packages/agent-sdk
npm install
npm run build          # tsup produces dist/index.js, dist/index.cjs, dist/index.d.ts

# 2. Copy the built package into myco's vendor directory:
#    (includes dist/ + package.json + node_modules/ for the SDK's own deps)
rsync -av --delete \
  /path/to/opencode/packages/agent-sdk/ \
  /path/to/myco/server/vendor/agent-sdk/ \
  --exclude .git --exclude src --exclude node_modules/.cache

# 3. Regenerate myco's server/package-lock.json:
cd /path/to/myco/server
npm install            # re-resolves "file:vendor/agent-sdk"

# 4. Rebuild the Docker image and deploy:
cd /path/to/myco
./scripts/deploy.sh
```

### Fresh-machine deploy with non-Anthropic provider

On a brand-new machine, deploying with Alibaba-CN or ZhipuAI requires no extra steps beyond the standard deploy flow — the vendored agent-sdk is already in the repo. Just configure the provider env vars:

```bash
# Clone and enter the repo:
git clone <repo-url> myco && cd myco

# Verify the vendored SDK is intact:
ls server/vendor/agent-sdk/dist/index.js  # should exist

# Deploy with provider config (local dev or production):
# --- Local dev ---
cd server && npm install && cd ..
MYCO_AGENT_PROVIDER=alibaba-cn \
MYCO_AGENT_API_KEY=sk-dashscope-your-key \
MYCO_STATE_DIR=$HOME/.myco \
PORT=3000 \
node server/src/index.js

# --- Production (Docker) ---
# Write provider config into the state dir's .env, then deploy:
mkdir -p $HOME/myco-state
cat > $HOME/myco-state/.env <<'EOF'
MYCO_AGENT_PROVIDER=alibaba-cn
MYCO_AGENT_API_KEY=sk-dashscope-your-key
MYCO_AGENT_MODEL=qwen3-235b-a22b
MYCO_AUX_MODEL=qwen-plus
MYCO_GH_CLIENT_ID=Iv1.abc123
MYCO_GH_CLIENT_SECRET=def456ghi789
MYCO_PUBLIC_ORIGIN=https://myco.example.com
EOF

MYCO_DEPLOY_HOST=user@localhost MYCO_STATE_DIR=$HOME/myco-state ./scripts/deploy.sh
```

### Verifying the agent-sdk in the running container

```bash
docker exec myco node -e "
  const sdk = require('/app/server/node_modules/@opencode-ai/agent-sdk');
  console.log('Exports:', Object.keys(sdk).join(', '));
  console.log('Supported providers:', sdk.supportedProviders.join(', '));
"
```

Expected output:
```
Exports: applyCaching, applyMessageNormalization, applyProviderOptions, applySchemaTransform, createAgent, generateText, jsonSchema, resolveProvider, supportedProviders, tool
Supported providers: alibaba-cn, alibaba, zhipuai, alibaba-coding-plan-cn, anthropic
```

## State Directory Layout

All persistent state lives under a single host directory (`$MYCO_STATE_DIR`). The container bind-mounts four subpaths:

```
$MYCO_STATE_DIR           → /data    (sessions.json, .env, auth-sessions.json, caddy/, git-tokens.json, …)
$MYCO_STATE_DIR/home      → /root    (claude config: .claude/, .claude.json)
$MYCO_STATE_DIR/wks       → /wks     (workspaces)
$MYCO_STATE_DIR/Caddyfile → /etc/caddy/Caddyfile  (read-only)
```

No named or anonymous Docker volumes. Backup = `tar` the state dir; restore = untar + `docker run`.

## Environment Variables

These are set in `$MYCO_STATE_DIR/.env` (loaded by `docker-entrypoint.sh`). The deploy script manages some; others must be set manually.

### Required (production)

| Variable | Purpose | Example |
|---|---|---|
| `MYCO_GH_CLIENT_ID` | GitHub OAuth App client ID | `Iv1.abc123` |
| `MYCO_GH_CLIENT_SECRET` | GitHub OAuth App client secret | `def456ghi789` |
| `MYCO_PUBLIC_ORIGIN` | Public URL of this myco instance | `https://myco.labxnow.ai` |

Set OAuth with:
```bash
./scripts/deploy.sh --set-oauth <client_id>:<client_secret>
```

The OAuth App's callback URL must be `<MYCO_PUBLIC_ORIGIN>/auth/github/callback`.

### Agent Provider (required for non-Anthropic)

| Variable | Purpose | Default | Supported Values |
|---|---|---|---|
| `MYCO_AGENT_PROVIDER` | Which LLM provider to use | `anthropic` | `anthropic`, `alibaba-cn`, `alibaba`, `zhipuai`, `alibaba-coding-plan-cn` |
| `MYCO_AGENT_API_KEY` | API key for the chosen provider | (none) | Any provider's API key |
| `MYCO_AGENT_MODEL` | Override the default model for the provider | (provider default) | `qwen3-235b-a22b`, `glm-5`, etc. |
| `MYCO_AUX_MODEL` | Model for auxiliary calls (/btw, summarizer, plan extractor) | (same as `MYCO_AGENT_MODEL`) | Any model supported by the provider |

**API key resolution priority:**

1. `MYCO_AGENT_API_KEY` if set
2. Provider-specific env var (see table below)
3. Error at startup if no key found

**Provider-specific env vars:**

| Provider ID | Env Var |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `alibaba-cn` | `DASHSCOPE_API_KEY` |
| `alibaba` | `DASHSCOPE_API_KEY` |
| `zhipuai` | `ZHIPU_API_KEY` |
| `alibaba-coding-plan` | `ALIBABA_CODING_PLAN_API_KEY` |
| `alibaba-coding-plan-cn` | `ALIBABA_CODING_PLAN_API_KEY` |

**Anthropic provider (default):** When `MYCO_AGENT_PROVIDER` is unset or `anthropic`, the container uses `@anthropic-ai/claude-agent-sdk` with auth from `~/.claude/` or `ANTHROPIC_API_KEY`. Set the key with:

```bash
./scripts/deploy.sh --set-anthropic-key sk-ant-…
```

**Non-Anthropic providers:** When `MYCO_AGENT_PROVIDER` is set to `alibaba-cn`, `zhipuai`, etc., the container uses `@opencode-ai/agent-sdk` with Vercel AI SDK. No `~/.claude/` setup is needed — auth is purely API-key-based.

Set a provider key manually in `.env`:
```bash
# On the remote host or via SSH:
echo 'MYCO_AGENT_PROVIDER=alibaba-cn' >> /home/kkrazy/myco-state/.env
echo 'MYCO_AGENT_API_KEY=sk-dashscope-your-key' >> /home/kkrazy/myco-state/.env
```

### Auth: GitHub Allowlist

File: `$MYCO_STATE_DIR/allowed-github-users.txt` — one GitHub login per line, `#` comments allowed. Only listed users can complete sign-in.

```bash
./scripts/deploy.sh --allow-github-user <login>
```

### Enterprise Proxy (optional)

| Variable | Purpose |
|---|---|
| `MYCO_ENTERPRISE_PROXY` | Set to `1` to enable proxy |
| `MYCO_ENTERPRISE_PROXY_URL` | Proxy URL, e.g. `http://user:pass@proxy-host:port` |
| `MYCO_ENTERPRISE_NO_PROXY` | No-proxy list (default: `127.0.0.1,localhost,local,.local`) |
| `MYCO_ENTERPRISE_TLS_INSECURE` | Set to `1` to disable TLS verification (proxy with self-signed certs) |

## Deploy Methods

### Remote Deploy (default)

Deploy to `myco.labxnow.ai` via SSH + Docker image streaming:

```bash
./scripts/deploy.sh
```

Default remote is `kkrazy@myco.labxnow.ai`, state dir `/home/kkrazy/myco-state`.

Override remote host and state dir:
```bash
MYCO_DEPLOY_HOST=user@otherhost \
MYCO_STATE_DIR=/path/on/remote \
./scripts/deploy.sh
```

The script:
1. Runs `./test/test.sh` locally
2. Builds the Docker image locally (`docker build -t myco:latest`)
3. Opens an SSH multiplexer to the remote
4. Ensures `$STATE_DIR`, `$STATE_DIR/home`, `$STATE_DIR/wks` exist
5. Seeds `Caddyfile` if missing
6. Seeds `allowed-github-users.txt` if missing
7. Warns if OAuth env vars are missing
8. Streams the image via `docker save | gzip | ssh … | gunzip | docker load`
9. Swaps the container (`docker rm` old + `docker run -d` new)
10. Verifies the deploy by checking the served build stamp
11. Runs post-deploy validation checks

### Local Deploy

Deploy on the machine you're running the script from (no SSH, no image streaming):

```bash
MYCO_DEPLOY_HOST=kkrazy@localhost ./scripts/deploy.sh
```

The script detects `localhost` / `127.0.0.1` in `MYCO_DEPLOY_HOST` and skips SSH + image streaming. Every step runs locally against the local Docker daemon. Useful when you're already on the target host.

Optional: override the verify-step domain (otherwise auto-derived from `.env`'s `MYCO_PUBLIC_ORIGIN` or `Caddyfile`):
```bash
MYCO_VERIFY_DOMAIN=myco.labxnow.ai \
MYCO_DEPLOY_HOST=kkrazy@localhost \
./scripts/deploy.sh
```

### Config-only Operations (no build/ship)

These flags do a single config write and exit — no Docker build, no image transfer, no container swap.

```bash
# Add a GitHub user to the allowlist
./scripts/deploy.sh --allow-github-user octocat

# Set OAuth credentials
./scripts/deploy.sh --set-oauth Iv1.abc123:def456ghi789

# Set Anthropic API key (writes to .env + restarts container)
./scripts/deploy.sh --set-anthropic-key sk-ant-api03-…

# Note: --set-anthropic-key validates the key format (must start with sk-ant-).
# For non-Anthropic provider keys, write them directly to .env on the host.
```

### Dry Run

Show what would happen without actually deploying:

```bash
./scripts/deploy.sh --dry-run
```

### Skip Tests or Post-checks

```bash
./scripts/deploy.sh --skip-tests          # skip ./test/test.sh pre-flight
./scripts/deploy.sh --skip-post-checks    # skip post-deploy validation
```

## Deploy Script Override Knobs

| Variable / Flag | Purpose | Default |
|---|---|---|
| `MYCO_DEPLOY_HOST` | SSH target for remote deploy | `kkrazy@myco.labxnow.ai` |
| `MYCO_STATE_DIR` | Persistent state directory on the host | `/home/kkrazy/myco-state` |
| `MYCO_IMAGE_TAG` | Docker image tag | `myco:latest` |
| `MYCO_CONTAINER` | Docker container name | `myco` |
| `MYCO_VERIFY_DOMAIN` | Domain for post-deploy HTTP check | auto-derived |
| `--skip-tests` | Skip pre-flight tests | off |
| `--skip-post-checks` | Skip post-deploy validation | off |
| `--dry-run` | Plan only, no deploy | off |

## Setting Non-Anthropic Provider Keys

There is no dedicated `--set-agent-key` flag yet. To configure a non-Anthropic provider, write the env vars directly into `$STATE_DIR/.env` on the host:

```bash
# SSH to the host or use local mode:
ssh kkrazy@myco.labxnow.ai

# Edit .env:
cat >> /home/kkrazy/myco-state/.env <<'EOF'
MYCO_AGENT_PROVIDER=alibaba-cn
MYCO_AGENT_API_KEY=sk-dashscope-your-key-here
MYCO_AGENT_MODEL=qwen3-235b-a22b
EOF

# Restart the container so the new env vars take effect:
docker restart myco
```

Or equivalently with local mode:
```bash
MYCO_DEPLOY_HOST=kkrazy@localhost ./scripts/deploy.sh --skip-tests
# (redeploy picks up the new .env on container restart)
```

## Container Bind-Mount Contract

The `docker run` command in `deploy.sh` mounts four paths:

```bash
docker run -d --name myco --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -v $STATE_DIR:/data \
  -v $STATE_DIR/home:/root \
  -v $STATE_DIR/wks:/wks \
  -v $STATE_DIR/Caddyfile:/etc/caddy/Caddyfile:ro \
  myco:latest
```

When `MYCO_AGENT_PROVIDER=anthropic`, the entrypoint also migrates `$STATE_DIR/.claude.json` → `/root/.claude.json` and `$STATE_DIR/.claude/` → `/root/.claude/` if they don't already exist in `/root/`. When provider is non-Anthropic, this migration is skipped entirely — no `~/.claude/` is needed.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `[connecting...]` loop in browser | WebSocket handshake failing before reaching server | See CLAUDE.md Troubleshooting §1 — usually firewall/proxy/HTTP/3 caching WS upgrade |
| "Login failed: OAuth state expired" | User took >5 min on GitHub authorize, or server restarted mid-flow | Click "Sign in with GitHub" again |
| "Not invited yet" | GitHub login not in allowlist | `./scripts/deploy.sh --allow-github-user <login>` |
| "No API key found for provider X" at startup | Missing env var for the configured provider | Set `MYCO_AGENT_API_KEY` or the provider-specific env var in `$STATE_DIR/.env` |
| `/btw` or summarizer returns error with non-Anthropic provider | Wrong model for auxiliary calls | Set `MYCO_AUX_MODEL` in `.env` to a lighter model (e.g. `qwen-plus` for alibaba-cn) |
| Deploy verification fails ("version mismatch") | Stale container or routing cache | `docker restart myco` or check Caddy/proxy caching |
| `./test/test.sh` fails locally | Missing `python3`, `docker`, or busybox `grep` | Install the missing tool; the script requires bash, python3, node, and standard GNU grep |