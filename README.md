# Intact · 인텍트

Intact is a private community portal for students of Incheon Science High School (인천과학고등학교). Members share questions and study materials, recruit teammates for competitions, and stay connected through realtime messaging and notifications. The service is in production.

- Live site: [https://ishsoutside.com](https://ishsoutside.com)
- Source: [ghandhitechnology/intact](https://github.com/ghandhitechnology/intact)
- Operations and deployment handover: [DEPLOYMENT_HANDOVER.md](./DEPLOYMENT_HANDOVER.md) (Korean)
- Runtime architecture and data flows: [ARCHITECTURE.md](./ARCHITECTURE.md) (Korean)

## What it does today

- Boards for Q&A, contest and project team recruitment, resource sharing, advanced-lab equipment, free discussion, and photos, plus school notices.
- Posts with drafts, edit history, comments and replies, recommendations, bookmarks, and unified search.
- Attachments stored in a private MinIO bucket. Every upload is streamed through ClamAV before it can be linked to a post or message; downloads go through permission-checked, short-lived signed URLs. Regular attachments are limited to 20 MB; the resources board accepts files up to 500 MB via browser-side multipart upload straight to MinIO. The photos board requires 1–12 images per post and verifies file signatures server-side.
- Two-layer content moderation for new posts: a local Korean text-restoration/OCR and image-forensics layer, followed by an isolated Codex (`gpt-5.6-luna`) review layer. Rollout is controlled by `MODERATION_MODE` (`OFF` / `SHADOW` / `ENFORCE`); see [MODERATION.md](./MODERATION.md).
- 1:1 and group messaging over Socket.IO, with read state, reconnect handling, and paginated history. Messages persist in PostgreSQL; Redis is only used for realtime fan-out.
- Notifications grouped per post or conversation, delivered in-app and via Web Push as an installable PWA.
- IGK, an activity-points system: a ledger-backed balance, transfers between members, contribution ranking and levels, daily attendance rewards, and a shop selling cosmetic items (nickname colors, avatar frames, titles, streak freezes).
- Student accounts use the school's Riroschool system for self-service registration, annual re-verification, and password recovery. A private Mac mini bridge connects over Tailscale, while purpose-bound administrator codes remain an emergency fallback for re-verification and recovery (`server/riro-bridge`).
- An admin console covering notices, reports and sanctions, user and invite management, and support requests, with an audit log for every privileged change.
- An optional "B-side" mode that anonymizes every other member server-side (stable per-activation hashes for names, hidden student codes) across posts, search, rankings, and chat, while each user still sees their own identity.

Student login IDs must be a 6-digit student code matching:

```text
^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$
```

Uniqueness is enforced twice: unique indexes on `User.loginId` and `StudentIdentity.studentCode`, and the registration API re-checks inside a serializable transaction, so one student code can never produce two accounts.

## Tech stack

| Area | Stack |
| --- | --- |
| Web / UI / API | Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS |
| Data | PostgreSQL 16, Prisma 5 |
| Realtime | Socket.IO, Redis |
| Files | MinIO (private S3-compatible bucket), ClamAV scanning |
| Moderation | Isolated OpenAI Codex adapter (`server/codex-moderation`) |
| Proxy / TLS | Caddy 2 |
| Runtime | Docker Compose, Node.js 22, Yarn 1.22.22 |

## Repository layout

```text
.
├── client/                    Next.js app: UI, REST API, Prisma schema/migrations, PWA
├── server/chat/               Socket.IO realtime gateway
├── server/codex-moderation/   Isolated Codex-based post moderation adapter
├── server/riro-bridge/        Private Riroschool identity bridge (runs on a Mac mini)
├── deploy/                    Production backup script and systemd units
├── design/                    Archived prototypes; not loaded in production
├── scripts/                   Verification helpers
├── Caddyfile                  HTTPS termination and /socket.io reverse proxy
├── docker-compose.yml         Complete production stack
├── ARCHITECTURE.md            Runtime boundaries and data flows
└── DEPLOYMENT_HANDOVER.md     VPS operations, backup, restore and rollback
```

Legacy internal identifiers such as `igwak`, `igwak-portal`, and `IGK` are kept on purpose for compatibility with the production database, Docker volumes, and the rewards unit. The user-facing service name is 인텍트 (Intact).

## Quick start (local)

### Requirements

- Node.js 22
- Corepack / Yarn 1.22.22
- Python 3.11+ for Riroschool bridge checks
- Docker Engine with Docker Compose v2

### Full stack

```bash
git clone https://github.com/ghandhitechnology/intact.git
cd intact
cp .env.example .env
```

Replace every `replace-*` value in `.env` with an independent random string (`openssl rand -hex 32` works well).

```bash
docker compose config --quiet
docker compose up -d --build postgres redis minio minio-init migrate web realtime
docker compose ps
```

- Web: `http://localhost:3000`
- Realtime gateway: `http://localhost:3001`
- MinIO console: `http://localhost:9001`

The `caddy` service only handles TLS for a real domain and is not needed for local development. The ClamAV, moderation, and outbox services are likewise optional for a first local run.

### Running from source

With the dependent services and environment variables in place:

```bash
cd client
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn prisma generate
corepack yarn prisma migrate deploy
corepack yarn dev
```

In a second terminal:

```bash
cd server/chat
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn dev
```

A demo mode (`PORTAL_DEMO_MODE` / `NEXT_PUBLIC_PORTAL_DEMO_MODE`) exists for quickly previewing the UI, but it does not exercise the API, database, or realtime paths. Both flags must be `false` in production.

## Verification

```bash
cd client
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn build

cd ../server/chat
corepack yarn build
```

Before a Docker deployment, also run:

```bash
git diff --check
docker compose config --quiet
```

Production deploys always start from a backup, then verify `/api/health`, the Socket.IO handshake, login, and the post/attachment/message/notification paths on the live environment. The full procedure is in [DEPLOYMENT_HANDOVER.md](./DEPLOYMENT_HANDOVER.md).

## Security ground rules

- Never use `prisma db push` against production; review migrations and apply them with `prisma migrate deploy`.
- The MinIO bucket and the internal Web/realtime ports are never exposed publicly.
- `PORTAL_ENCRYPTION_KEY` is required to decrypt existing real-name data and is backed up in a separate secret store.
- Admin and portal sessions are separate, and all admin actions are written to an audit log.

## Documentation rule

When API boundaries or service composition change, update `ARCHITECTURE.md` in the same change set. When the domain, server, volumes, deployment, or backup procedures change, update `DEPLOYMENT_HANDOVER.md` in the same change set.
