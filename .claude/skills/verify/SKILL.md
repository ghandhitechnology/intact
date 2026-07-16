---
name: verify
description: Exercise Intact portal and moderation changes through local HTTP surfaces.
---

# Verify Intact runtime changes

## Portal

1. Run the Next.js app from `client/` so Tailwind resolves paths correctly: `corepack yarn dev -p 3100`.
2. For maintenance middleware work without PostgreSQL, set `INTERNAL_API_URL` to a temporary local HTTP stub whose `/api/platform` response is `{"data":{"maintenanceEnabled":true}}`.
3. Observe `GET /` rewriting to `/maintenance`, API routes returning the structured `503 MAINTENANCE` response, unauthenticated `/admin` redirecting to login, and `/maintenance` redirecting home after the stub reports `false` and the five-second cache expires.

## Moderation adapter

1. From `server/codex-moderation/`, run `CODEX_MODERATION_SECRET=<temporary-secret> PORT=8788 npm start`.
2. Observe `/health`, an unauthenticated `/v1/classify` request, and malformed authenticated multipart input.
3. Run `npm run probe` or `npm run security-probe` only when sending a real classification request to the configured model has been approved.

Do not use production credentials, databases, or content during local verification.
