# 인텍트 Web

인텍트의 Next.js 15 애플리케이션입니다. App Router 안에 화면과 REST API가 함께 있고, Prisma가 PostgreSQL 스키마와 migration을 관리합니다.

## 주요 디렉터리

```text
src/app/                 페이지, route handler, 전역 error/loading UI
src/components/          커뮤니티, 인증, 포털 공통 UI
src/lib/server/          세션, 암호화, HTTP 검증, 스토리지, 운영 로직
src/lib/student-code.ts  공유 학번 형식 검증
prisma/schema.prisma     데이터 모델
prisma/migrations/       순차 production migration
public/sw.js             PWA service worker
```

## 실행

저장소 루트의 `.env.example`은 전체 Docker 스택용이고, 이 디렉터리의 `.env.example`은 Web을 직접 실행할 때의 최소 예시입니다.

```bash
cp .env.example .env.local
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn prisma generate
corepack yarn prisma migrate deploy
corepack yarn dev
```

`DATABASE_URL`, Redis, MinIO 및 realtime gateway가 실제로 접근 가능한 주소인지 확인하세요. 운영 `.env`를 개발 장비에 복사하지 않습니다.

## 검사

```bash
corepack yarn lint
corepack yarn prisma validate
corepack yarn tsc --noEmit
corepack yarn build
```

production에서는 `prisma db push`를 사용하지 않습니다. 스키마 변경은 새 migration으로 만들고, 운영 DB 백업과 테스트 후 `prisma migrate deploy`로 적용합니다.

전체 구조는 [ARCHITECTURE.md](../ARCHITECTURE.md), VPS 운영은 [DEPLOYMENT_HANDOVER.md](../DEPLOYMENT_HANDOVER.md)를 확인하세요.
