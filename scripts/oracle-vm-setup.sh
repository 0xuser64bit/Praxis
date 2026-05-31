#!/usr/bin/env bash
#
# Praxis agent signer — one-shot setup for an Oracle Cloud Always-Free VM.
#
# The Next.js app stays on Vercel. The ONE thing that must not live in Vercel's
# environment is the Aegis *agent private key* — so it lives here, on a tiny VM,
# behind the standalone signer service (signer/). The Vercel app talks to it over
# HTTPS (Cloudflare Tunnel) and holds only the agent PUBLIC key + a bearer token.
#
# Intended flow: SSH into a fresh Oracle Ubuntu VM, clone this repo, then run:
#     bash scripts/oracle-vm-setup.sh
#
# Idempotent: safe to re-run. It will install Bun + deps, generate the agent key
# and bearer token if missing, install a systemd service for the signer, set up a
# Cloudflare Tunnel, and finally print the exact env vars to paste into Vercel.
#
# Tunables (all optional — sensible defaults):
#   SIGNER_PORT=8787
#   SIGNER_TOKEN=<bearer>            # generated if unset
#   AGENT_KEYPAIR_PATH=<repo>/keys/agent.json
#   SIGNER_AEGIS_PROGRAM_ID=<id>     # defaults to the repo's program id
#   CLOUDFLARE_TUNNEL_TOKEN=<token>  # if set → stable named tunnel; else a quick
#                                    #   (ephemeral URL) tunnel for testing
set -euo pipefail

# ---- locate repo root (this script lives in <repo>/scripts) -----------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

SIGNER_PORT="${SIGNER_PORT:-8787}"
AGENT_KEYPAIR_PATH="${AGENT_KEYPAIR_PATH:-$REPO_DIR/keys/agent.json}"
ENV_FILE="/etc/praxis-signer.env"
SERVICE_USER="${SUDO_USER:-$USER}"

log()  { printf '\033[1;33m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---- 1. system packages -----------------------------------------------------
log "Installing base packages (curl, unzip, openssl)…"
if have apt-get; then
  sudo apt-get update -y
  sudo apt-get install -y curl unzip openssl ca-certificates
elif have dnf; then
  sudo dnf install -y curl unzip openssl ca-certificates
else
  echo "Unsupported package manager — install curl, unzip, openssl manually." >&2
fi

# ---- 2. Bun -----------------------------------------------------------------
if ! have bun; then
  log "Installing Bun…"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
BUN_BIN="$(command -v bun)"
ok "Bun at $BUN_BIN ($($BUN_BIN --version))"

# ---- 3. dependencies --------------------------------------------------------
log "Installing project dependencies (bun install)…"
bun install --frozen-lockfile || bun install
ok "Dependencies installed"

# ---- 4. agent keypair -------------------------------------------------------
mkdir -p "$(dirname "$AGENT_KEYPAIR_PATH")"
if [ ! -f "$AGENT_KEYPAIR_PATH" ]; then
  log "Generating a fresh agent keypair → $AGENT_KEYPAIR_PATH"
  bun -e 'import {Keypair} from "@solana/web3.js"; import {writeFileSync} from "node:fs";
    const kp = Keypair.generate();
    writeFileSync(process.argv[1], JSON.stringify(Array.from(kp.secretKey)));
    console.log(kp.publicKey.toBase58());' "$AGENT_KEYPAIR_PATH" >/dev/null
  chmod 600 "$AGENT_KEYPAIR_PATH"
  ok "Agent keypair created"
else
  ok "Agent keypair already present (left untouched)"
fi

AGENT_PUBKEY="$(bun -e 'import {Keypair} from "@solana/web3.js"; import {readFileSync} from "node:fs";
  const a = JSON.parse(readFileSync(process.argv[1], "utf8"));
  console.log(Keypair.fromSecretKey(Uint8Array.from(a)).publicKey.toBase58());' "$AGENT_KEYPAIR_PATH")

# ---- 5. bearer token --------------------------------------------------------
if [ -z "${SIGNER_TOKEN:-}" ]; then
  if [ -f "$ENV_FILE" ] && grep -q '^SIGNER_TOKEN=' "$ENV_FILE"; then
    SIGNER_TOKEN="$(sudo grep '^SIGNER_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
    ok "Reusing existing SIGNER_TOKEN from $ENV_FILE"
  else
    SIGNER_TOKEN="$(openssl rand -base64 32)"
    ok "Generated a new SIGNER_TOKEN"
  fi
fi

# ---- 6. systemd service for the signer --------------------------------------
log "Writing $ENV_FILE and the praxis-signer systemd service…"
sudo tee "$ENV_FILE" >/dev/null <<EOF
SIGNER_TOKEN=$SIGNER_TOKEN
SIGNER_AGENT_KEYPAIR_PATH=$AGENT_KEYPAIR_PATH
SIGNER_PORT=$SIGNER_PORT
${SIGNER_AEGIS_PROGRAM_ID:+SIGNER_AEGIS_PROGRAM_ID=$SIGNER_AEGIS_PROGRAM_ID}
EOF
sudo chmod 600 "$ENV_FILE"

sudo tee /etc/systemd/system/praxis-signer.service >/dev/null <<EOF
[Unit]
Description=Praxis Aegis agent signer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$BUN_BIN run signer
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now praxis-signer.service
sleep 2
if curl -fsS "http://127.0.0.1:$SIGNER_PORT/" >/dev/null; then
  ok "Signer is live on 127.0.0.1:$SIGNER_PORT"
else
  echo "⚠ Signer did not respond yet. Check: sudo journalctl -u praxis-signer -n 50" >&2
fi

# ---- 7. Cloudflare Tunnel ---------------------------------------------------
if ! have cloudflared; then
  log "Installing cloudflared…"
  ARCH="$(uname -m)"; case "$ARCH" in aarch64|arm64) CF_ARCH=arm64;; x86_64) CF_ARCH=amd64;; *) CF_ARCH=amd64;; esac
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb"
  sudo dpkg -i /tmp/cloudflared.deb || sudo apt-get install -f -y
fi

PUBLIC_URL=""
if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  log "Installing the named Cloudflare Tunnel connector (stable URL)…"
  sudo cloudflared service install "$CLOUDFLARE_TUNNEL_TOKEN" || true
  sudo systemctl enable --now cloudflared || true
  ok "Named tunnel connector running. In the Cloudflare dashboard, route your"
  echo "  hostname → http://localhost:$SIGNER_PORT, then use https://<that-host>/sign below."
else
  log "No CLOUDFLARE_TUNNEL_TOKEN — starting a QUICK tunnel (ephemeral URL, testing only)…"
  sudo tee /etc/systemd/system/praxis-tunnel.service >/dev/null <<EOF
[Unit]
Description=Praxis signer quick Cloudflare Tunnel
After=praxis-signer.service
Wants=praxis-signer.service

[Service]
Type=simple
ExecStart=$(command -v cloudflared) tunnel --no-autoupdate --url http://127.0.0.1:$SIGNER_PORT
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now praxis-tunnel.service
  log "Waiting for the quick-tunnel URL…"
  for _ in $(seq 1 20); do
    PUBLIC_URL="$(sudo journalctl -u praxis-tunnel --no-pager 2>/dev/null \
      | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
    [ -n "$PUBLIC_URL" ] && break
    sleep 1
  done
fi

# ---- 8. report --------------------------------------------------------------
SIGN_ENDPOINT="${PUBLIC_URL:+$PUBLIC_URL/sign}"
cat <<EOF

────────────────────────────────────────────────────────────────────
 ✓ Praxis signer is set up on this VM.
────────────────────────────────────────────────────────────────────
 Agent public key : $AGENT_PUBKEY
 Local signer     : http://127.0.0.1:$SIGNER_PORT
 Public endpoint  : ${SIGN_ENDPOINT:-<set up your named-tunnel hostname>/sign}

 Paste these into your Vercel project's environment (Production):

   PRAXIS_AGENT_SIGNER_URL=${SIGN_ENDPOINT:-https://<your-tunnel-host>/sign}
   PRAXIS_AGENT_PUBLIC_KEY=$AGENT_PUBKEY
   PRAXIS_AGENT_SIGNER_TOKEN=$SIGNER_TOKEN

 Then REMOVE PRAXIS_AGENT_KEYPAIR / PRAXIS_AGENT_KEYPAIR_PATH from Vercel,
 and leave PRAXIS_ALLOW_LOCAL_AGENT_KEY unset (so a raw in-process key is refused).

 Service controls:
   sudo systemctl status praxis-signer
   sudo journalctl -u praxis-signer -f
────────────────────────────────────────────────────────────────────
EOF
${PUBLIC_URL:+true} || echo "⚠ Quick tunnels get a NEW URL on every restart — use CLOUDFLARE_TUNNEL_TOKEN for production."
