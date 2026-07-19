# 인텍트 안정성 점검 보고서

점검일: 2026-07-15 (Asia/Seoul)

## 범위

- Next.js UI와 API의 lint, TypeScript, production build
- 공개 health, 로그인 화면, Socket.IO handshake 부하
- 로그인 상태의 게시판, IGK 랭킹, 알림, 대화방 조회 부하
- 동일 학번 동시 가입 경쟁 조건
- 세션 장애, 오프라인, 느린 API, 부분 데이터 실패 시 사용자 경험
- 파일 미리보기, MinIO, realtime 컨테이너의 장애 경계

운영 데이터를 변경하는 게시글·댓글·IGK 전송 부하는 수행하지 않았다. 가입 경쟁 조건은 별도 임시 학번으로만 검증하고 즉시 삭제한다.

## 발견한 오류와 수정

| 심각도 | 재현 결과 | 원인 | 수정 |
| --- | --- | --- | --- |
| 높음 | 같은 학번으로 6건 동시 가입 시 1건 성공, 4건 409, 1건 500 | Serializable transaction의 Prisma `P2034` write conflict를 재시도하지 않음 | 계정·초대·재인증 transaction에 제한된 재시도 적용. 고유 제약은 그대로 최종 중복을 차단 |
| 높음 | 세션 API가 500 또는 비 JSON 응답이면 로그인 화면으로 이동할 수 있음 | 장애 응답을 미인증으로 해석 | 명시적인 `authenticated: boolean` 응답만 로그아웃 판단에 사용하고 연결 오류 배너와 재시도 제공 |
| 높음 | PDF 문서 미리보기 iframe이 브라우저에서 차단됨 | 모든 응답에 `X-Frame-Options: DENY` 적용 | 외부 framing은 막으면서 같은 origin preview를 허용하는 `SAMEORIGIN` 적용 |
| 중간 | 홈 게시판 목록 1회 조회에 통계용 count query가 게시판당 4개 발생 | N×4 통계 조회 | PostgreSQL CTE 집계 1회로 통합 |
| 중간 | 홈의 공지·게시판·랭킹 중 하나가 실패하면 전체가 빈 화면으로 보임 | `Promise.all`과 단일 loading 상태 | `Promise.allSettled`, 부분 데이터 유지, 명시적 재시도 적용 |
| 중간 | 게시판·검색·공지 실패가 결과 없음처럼 보임 | 오류 상태와 빈 상태를 구분하지 않음 | 실패 문구, 재시도, 요청 취소와 12초 timeout 적용 |
| 중간 | 메시지 realtime이 끊겨도 상태를 알 수 없고 숨긴 탭에서도 잦은 polling | 연결 상태 부재, 고정 20초 polling | 실시간/연결 중/재연결 중 표시, visible 상태 45초 fallback과 focus/online 복구 적용 |
| 중간 | realtime 프로세스가 멈춰도 Compose health에 드러나지 않음 | healthcheck와 종료 처리 부재 | 연결 수를 포함한 no-store health, Docker healthcheck, SIGTERM/SIGINT graceful shutdown 추가 |
| 중간 | MinIO 응답 정지 시 Web 요청도 장시간 대기 | object storage fetch timeout 부재 | 30초 timeout 적용 |
| 낮음 | 검색 사용자 행의 화살표가 눌려도 동작하지 않음 | action 없는 버튼 | 오해를 만드는 버튼 제거 |
| 낮음 | rate limit 응답에 표준 재시도 시각이 없음 | `Retry-After` header 부재 | 429 응답에 초 단위 header 추가 |
| 낮음 | 로그인 UI 최소 비밀번호 길이가 서버 정책보다 짧음 | 클라이언트 8자, 정책 10자 | 10자로 통일하고 제출 중 중복 입력 차단 |

## 수정 전 운영 부하 기준

모든 측정은 `https://ishsoutside.com`에서 읽기 요청만 사용했다.

| 경로 | 요청/동시성 | 결과 | 처리량 | p95 | 최대 |
| --- | ---: | --- | ---: | ---: | ---: |
| DB health | 400 / 30 | 400×200, 실패 0 | 125.1 req/s | 524.5ms | 680.9ms |
| session | 400 / 30 | 400×200, 실패 0 | 136.0 req/s | 315.3ms | - |
| 로그인 화면 | 250 / 20 | 250×200, 실패 0 | 87.1 req/s | 345.0ms | - |
| Socket.IO handshake | 100 / 10 | 100×200, 실패 0 | 54.3 req/s | 240.7ms | - |
| 게시판 목록 | 120 / 10 | 120×200, 실패 0 | 21.3 req/s | 773.7ms | - |
| IGK 랭킹 | 160 / 20 | 160×200, 실패 0 | 35.2 req/s | 1216.9ms | - |
| 알림 | 160 / 20 | 160×200, 실패 0 | 31.6 req/s | 1443.6ms | - |
| 대화방 | 160 / 20 | 160×200, 실패 0 | 33.9 req/s | 1047.9ms | 1734.2ms |

## 수정 후 운영 부하 결과

같은 Mac과 공개 도메인, 같은 요청 수·동시성으로 다시 측정했다. 모든 1,350건이 HTTP 200이었고 5xx, network error, timeout은 0건이었다.

| 경로 | 요청/동시성 | 결과 | 처리량 | p95 | 최대 |
| --- | ---: | --- | ---: | ---: | ---: |
| DB health | 400 / 30 | 400×200, 실패 0 | 96.0 req/s | 804.9ms | 906.4ms |
| 로그인 화면 | 250 / 20 | 250×200, 실패 0 | 84.9 req/s | 786.6ms | 859.6ms |
| Socket.IO handshake | 100 / 10 | 100×200, 실패 0 | 43.9 req/s | 533.2ms | 569.0ms |
| 게시판 목록 | 120 / 10 | 120×200, 실패 0 | 41.0 req/s | 582.4ms | 667.5ms |
| IGK 랭킹 | 160 / 20 | 160×200, 실패 0 | 82.2 req/s | 531.9ms | 573.5ms |
| 알림 | 160 / 20 | 160×200, 실패 0 | 81.4 req/s | 525.4ms | 554.0ms |
| 대화방 | 160 / 20 | 160×200, 실패 0 | 84.0 req/s | 317.3ms | 520.8ms |

게시판은 query 통합 후 처리량이 21.3→41.0 req/s로 92% 늘고 p95가 773.7→582.4ms로 줄었다. 인증 API 4개도 모두 개선됐다. 반면 코드 경로가 거의 바뀌지 않은 공개 3개 요청은 외부 구간의 tail latency가 커졌다. 같은 시점 VPS→공개 도메인 측정에서는 health p95 133.2ms, 로그인 83.2ms, Socket.IO 29.2ms였고 서버 CPU·메모리 여유와 restart 0을 확인했으므로, 공개 3개 차이는 서버 포화가 아니라 측정 구간의 네트워크 변동으로 분류한다.

동일 학번 6건 동시 가입은 수정 전 `201×1 + 409×4 + 500×1`에서 수정 후 `201×1 + 409×5`로 바뀌었다. 생성된 계정은 항상 1개였으며 테스트 후 `User`와 `StudentIdentity`가 모두 0건임을 확인했다.

## 반복 실행

```bash
node scripts/stress-readonly.mjs --base=https://ishsoutside.com --requests=120 --concurrency=12
```

로그인 경로까지 점검할 때는 전용 테스트 계정의 cookie를 셸 환경변수로만 전달한다. cookie 값은 명령 기록, 문서, CI 로그에 출력하지 않는다.

```bash
INTACT_TEST_COOKIE='portal_session=REDACTED' \
  node scripts/stress-readonly.mjs \
    --base=https://ishsoutside.com \
    --scenarios=boards,ranking,notifications,chat-rooms \
    --requests=120 \
    --concurrency=12
```

network error와 HTTP 5xx가 하나라도 있으면 exit code 1을 반환한다. 4xx/429는 정상적인 거부일 수 있으므로 status 분포에 표시하되 자동 실패로 판정하지 않는다.
