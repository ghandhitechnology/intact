# Riroschool bridge

Private authentication bridge intended to run on the Korean Mac mini and listen only on its
Tailscale IP. The portal signs every request with `RIRO_BRIDGE_SECRET`; Riroschool credentials
are used in memory and are never logged or stored.

Required environment:

- `RIRO_BRIDGE_SECRET`: independent random value of at least 32 characters
- Portal: `RIRO_AUTH_MODE=BRIDGE`, `RIRO_BRIDGE_URL=http://<tailscale-ip>:8765`, and the same secret

The service must not be exposed as an unauthenticated public proxy. Disable HTTP access logs and
restrict port 8765 to the production portal's Tailscale identity.

## macOS installation

After copying this directory to the Korean Mac mini:

```bash
chmod +x install-macos.sh
RIRO_BRIDGE_SECRET="$(openssl rand -hex 32)" ./install-macos.sh
```

The installer creates a private virtual environment under `~/Library/Application Support`, binds
the service to the Mac's Tailscale IPv4 address, and installs a per-user LaunchAgent so it starts
again after login or reboot. Use the same generated secret in the portal VPS `.env`.
