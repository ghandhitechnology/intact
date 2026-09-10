# 로딩 성능 개선 기록

2026-09-11 기준 `6d0a257`과 이 변경을 비교했습니다. 측정은 운영 정보가 없는 로컬 합성 DB에서 수행했습니다. [브라우저 표본](benchmarks/loading-2026-09-11/browser.json)과 [서버 표본](benchmarks/loading-2026-09-11/reads.json)을 함께 보관합니다.

## 브라우저에서 콘텐츠가 나타나는 시간

| 화면 | 기존 중앙값 | 개선 중앙값 | 단축 |
| --- | ---: | ---: | ---: |
| 로그인 | 742.9 ms | 383.4 ms | 48.4% |
| 홈 | 1,012.2 ms | 981.1 ms | 3.1% |
| 대화 내용 | 1,356.0 ms | 1,273.6 ms | 6.1% |
| 질문 게시판 | 1,194.2 ms | 986.8 ms | 17.4% |
| 알림 | 965.1 ms | 938.5 ms | 2.8% |
| 내 프로필 | 1,108.5 ms | 926.5 ms | 16.4% |

각 화면에서 두 버전을 번갈아 7회씩, 총 84회 측정했습니다. 로그인은 입력 폼, 홈·게시판은 첫 게시글 링크, 대화는 메시지 본문, 알림은 첫 알림, 프로필은 사용자 이름이 DOM에 반영된 뒤 두 프레임이 지난 시점입니다. 로그인 수치는 폼 표시 시간이며 이벤트 처리 준비 시간이나 Core Web Vitals 점수가 아닙니다.

동일한 Chrome·Mac mini에서 Node.js 22.23.2, Next.js 15.5.25 production build, PostgreSQL 17을 사용했습니다. 두 버전은 같은 게시글 5,000개와 대화방 20개·메시지 10,000개를 읽었습니다. 로컬 HTTP/1.1 프록시가 모든 HTTP 응답에 150ms를 추가하고 텍스트를 gzip으로 압축했습니다. HTTP 캐시와 탭의 콘텐츠 캐시는 매 회 비웠고 CPU·대역폭 제한은 추가하지 않았습니다. 운영 서버의 HTTP/2·PostgreSQL 16·실제 데이터 분포에서는 수치가 달라질 수 있습니다.

콘텐츠 표시 후 750ms까지 수집한 리소스 요청 중앙값은 홈 43→20개, 대화 46→22개, 게시판 37→19개입니다. 알림 화면의 첫 진입에서 환경설정과 푸시 설정 요청 2개를 없앴고, 설정 창을 열 때 조회합니다. 홈·알림의 브라우저 시간 차이는 작으므로 주요 성과는 로그인·게시판·프로필의 표시 시간과 서버 조회량 감소로 평가합니다.

## 서버 조회 비용

| 측정 경로 | 기존 중앙값 | 개선 중앙값 | SQL 및 데이터 조회 변화 |
| --- | ---: | ---: | --- |
| `/api/home` 전체 handler | 43.23 ms | 5.75 ms | SQL 31→19개, 글 본문 5,000→35행 |
| 대화방 목록 조회 함수 | 35.64 ms | 1.96 ms | 메시지 본문 10,000→20행 |

각 20회 warm 측정입니다. 홈 응답은 생성 시각을 제외하면 동일했고, 대화방 결과도 동일했습니다. 대화방 수치는 인증·HTTP 전송을 제외한 조회 함수의 시간입니다. 홈 handler의 p95는 45.94→7.55ms였습니다. 검색은 게시글·사용자 마스킹을 한 번에 처리하여 A-side에서 SQL 15→14개로 줄였고 A-side·B-side의 응답이 기존과 일치했습니다.

Prisma 5는 관계의 `take: 5`나 `take: 1`을 일부 조회에서 메모리에서 적용했습니다. 홈은 SQL에서 게시판별 글 ID 5개를 먼저 고르고, 대화방은 기존 인덱스와 `LATERAL ... LIMIT 1`으로 최신 메시지만 읽습니다. 새 인덱스나 migration은 필요하지 않습니다.

## 변경 범위와 검증

- 문서에서 세션·전역 모드를 병렬로 준비하여 초기 클라이언트 요청 대기를 줄였습니다. 각각 1초 제한과 독립적인 API 재시도를 유지합니다. 로그인 뒤 새 세션 확인을 기다리는 동작도 유지합니다.
- 홈의 내부 route handler 재호출을 공용 조회 함수로 바꿨습니다. 알림 개수만 세고, 홈에서 쓰지 않는 IGK 원장은 읽지 않습니다. 일부 조회 실패 시 나머지 영역을 표시하는 계약은 유지합니다.
- 공통·게시판·검색 링크의 viewport prefetch를 의도 기반 요청으로 바꿨습니다. 사용하지 않던 대화방 사전 요청을 제거하고 Socket.IO와 사진 뷰어를 동적 import로 분리했습니다. 첫 전체 글 이미지는 우선 요청합니다.
- 사용자별 서버 문서의 `no-store`, 동시 요청 간 세션 분리, 무효 세션, 오프라인 문서의 신원 정보 제외를 HTTP로 확인했습니다. 소켓 연결·알림 설정·로그인 응답 경합도 브라우저로 확인했습니다. 모드 알림이 누락될 때를 위한 기존 5초 확인은 유지합니다.
- `scripts/verify.sh`의 lint·typecheck·전체 클라이언트 테스트·production build·realtime build·모더레이션 구문 검사·리로 브리지 테스트가 통과했습니다. 실제 PostgreSQL 통합 테스트에서 공개 글 정렬, 숨김·미래 글, 빈 방, 탈퇴한 참여자, 삭제 메시지, 안 읽은 메시지 및 큰 sequence 값을 확인했습니다.

## 재현

두 체크아웃에 Node.js 22·Yarn 1.22.22 의존성과 Prisma Client를 준비하고 같은 migration을 적용한 로컬 `test` 또는 `bench` DB를 사용합니다. 운영 환경변수나 데이터를 복사하지 않습니다.

```bash
git worktree add --detach /tmp/intact-perf-before 6d0a257
# 두 체크아웃의 client에서 yarn install --frozen-lockfile 및 yarn prisma generate를 실행합니다.
cd client
TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/intact_bench \
BASELINE_REPO=/tmp/intact-perf-before \
yarn tsx scripts/benchmark-read-paths.ts
```

이 스크립트는 합성 게시글 1,500개와 메시지 10,000개를 추가하고, 두 버전의 실제 handler 응답 일치·SQL 수·실제 조회 행 수·시간을 검사한 뒤 모두 롤백합니다. 기존 테스트 DB의 게시판도 포함됩니다. 롤백을 위해 단일 DB 연결을 사용하므로 위 연결 풀 측정과 시간이 다릅니다. 빈 로컬 DB에서도 응답 일치와 롤백을 확인했습니다. 별도 의미 검증은 다음 명령으로 실행합니다.

```bash
TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/intact_bench \
yarn tsx --test tests/board-reads.integration.ts tests/chat-room-list.integration.ts
```

브라우저 비교는 두 production 서버를 각각 3194·3195 포트에서 같은 합성 DB·환경변수로 실행한 뒤 저장소 루트에서 프록시를 엽니다. 대화 검증 시 realtime을 3196 포트에 띄우고 프록시 origin을 허용합니다.

```bash
node scripts/benchmark-browser.mjs
```

`http://localhost:3212/__bench/start?variant=baseline&path=/login&auth=0&run=1`과 `variant=optimized`를 번갈아 엽니다. 인증 화면은 먼저 프록시에서 합성 계정으로 로그인하고 `path`를 `/`, `/messages`, `/boards/question`, `/notifications`, `/profile`로 바꿉니다. 터미널에 결과가 기록되면 다음 문서를 열며 예열 표본은 제외합니다. `BENCH_PORT`, `BENCH_LATENCY_MS`, `BENCH_OUTPUT_DIR`로 조건과 저장 위치를 지정할 수 있습니다. 재현용 프록시는 개인정보 경로 대신 asset/api/other 분류와 시간·바이트만 기록하고 측정 중 DOM을 변경하지 않습니다.
