# Riroschool bridge

Private authentication bridge intended to run on the Korean Mac mini and listen only on its
Tailscale IP. The portal signs every request with `RIRO_BRIDGE_SECRET`; Riroschool credentials
are used in memory and are never logged or stored.

Required environment:

- Python 3.11 or newer
- `RIRO_BRIDGE_SECRET`: independent random 64-character hexadecimal value
- Portal: `RIRO_AUTH_MODE=BRIDGE`, `RIRO_BRIDGE_URL=http://<tailscale-ip>:8765`, and the same secret

The service must not be exposed as an unauthenticated public proxy. Disable HTTP access logs and
restrict port 8765 to the production portal's Tailscale identity.

## macOS installation

After copying this directory to the Korean Mac mini:

```bash
chmod +x install-macos.sh
RIRO_BRIDGE_SECRET="$(openssl rand -hex 32)" ./install-macos.sh
```

The installer first builds a temporary virtual environment and exercises the FastAPI lifespan. It
does not replace or restart the existing service unless that preflight succeeds. It then creates a
private virtual environment under `~/Library/Application Support`, binds the service to the Mac's
Tailscale IPv4 address, and installs a per-user LaunchAgent. A LaunchAgent starts after that user's
GUI login. Recovery after a reboot therefore requires a login or configured automatic login. Use
the same generated secret in the portal VPS `.env`.

`GET /health` reports bridge contract version `2`, Python readiness, and circuit state. The v2
profile keeps the immutable first-year student number separate from the current grade/class. It does not
probe Riroschool or expose school, account, or profile data.
