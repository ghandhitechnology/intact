# 인텍트 Realtime Gateway

Socket.IO 기반의 실시간 메시지·읽음·접속 이벤트 게이트웨이입니다. 영구 데이터의 기준은 Web API와 PostgreSQL이며, 이 서버는 독립적인 사용자 DB를 만들지 않습니다.

## 연결 경계

- 브라우저는 production에서 같은 origin의 `/socket.io/`로 연결합니다.
- Caddy가 해당 경로를 `realtime:3001`로 전달합니다.
- gateway는 `INTERNAL_API_SECRET`으로 Web의 내부 authorize endpoint를 호출합니다.
- Redis adapter로 여러 realtime instance 사이 이벤트를 전달합니다.
- 메시지 저장과 권한 판단은 Web API/PostgreSQL이 담당합니다.

## 환경변수

| 키 | 역할 |
| --- | --- |
| `PORT` | 기본 `3001` |
| `WEB_ORIGIN` | 허용할 Web origin |
| `INTERNAL_API_URL` | Web 컨테이너 내부 주소 |
| `INTERNAL_API_SECRET` | Web과 공유하는 내부 인증 비밀값 |
| `REDIS_URL` | Redis 연결 주소 |

## 실행과 검사

```bash
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn dev
corepack yarn build
```

운영 연결과 장애 점검은 [DEPLOYMENT_HANDOVER.md](../../DEPLOYMENT_HANDOVER.md)를 따릅니다.
