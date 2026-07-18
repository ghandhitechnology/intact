# 이중망 Moderation 운영

게시물은 로컬 한국어 복원/OCR·이미지 포렌식 계층과 Codex `gpt-5.6-luna` 계층을 모두 통과합니다. 일반 파일 악성코드 검사 게이트는 다시 추가하지 않았습니다. 이미지에 한해 메타데이터 제거, GIF 최대 3프레임 샘플링, 한국어·영어 OCR, 64비트 perceptual hash를 수행합니다.

## 최초 VPS 인증

`.env`에 충분히 긴 `CODEX_MODERATION_SECRET`을 설정한 뒤 전용 OAuth 볼륨에 한 번만 로그인합니다. 토큰을 읽거나 다른 HTTP bearer로 전달하지 않습니다.

```bash
docker compose --profile tools build codex-auth codex-moderation
docker compose --profile tools run --rm codex-auth
docker compose up -d codex-moderation moderation-worker web
```

표시되는 URL과 device code로 승인합니다. OAuth 볼륨은 `codex-auth`와 `codex-moderation`에만 read-write로 연결됩니다. `web`과 `moderation-worker`에는 연결되지 않습니다.

## 배포 호환성 검사

다음 검사는 ChatGPT 로그인, Codex CLI `0.144.5`, 고정 모델 `gpt-5.6-luna`, 실제 이미지 입력, JSON Schema 출력을 한 번에 확인합니다.

```bash
docker compose exec codex-moderation node src/probe.mjs
docker compose exec codex-moderation node src/security-probe.mjs
```

실패하면 어댑터 health가 비정상이 되며 게시물은 공개되지 않고 운영자 검토로 이동합니다. 다른 모델로 자동 fallback하지 않습니다.

## 롤아웃과 복구

1. `MODERATION_MODE=SHADOW`로 48시간 운영하고 `/admin/moderation`에서 한국어/이미지 판정을 검토합니다. 이 모드에서는 기존 게시 동작을 유지하면서 판정만 축적합니다.
2. 라벨링한 사례를 확인한 뒤 `MODERATION_MODE=ENFORCE`로 바꾸고 `web`과 `moderation-worker`를 재시작합니다.
3. 긴급 복구는 `MODERATION_MODE=OFF`입니다. `OFF`에서는 새 심사 제출을 만들지 않고 기존 게시 동작을 사용합니다.

`ENFORCE`에서 두 검사 계층이 모두 고신뢰도로 유해하다고 확정한 새 게시물은 공개되지 않으며 즉시 soft delete(`DELETED`, `deletedAt`)됩니다. 판정 근거와 첨부 관계는 감사 및 오탐 검토를 위해 보존합니다. 불확실한 판정과 검사 실패는 자동 삭제하지 않고 `NEEDS_REVIEW`로 보냅니다.

```bash
docker compose up -d --force-recreate web moderation-worker
```

ChatGPT OAuth로 처리한 학생 게시물은 선택한 ChatGPT workspace의 권한과 보존 정책을 따릅니다. API/ZDR 설정이 적용되는 경로가 아니므로, `ENFORCE` 전 학교의 개인정보·학생 콘텐츠 처리 승인이 필요합니다.

## 격리 점검

- `codex-moderation`은 공개 port, DB URL, MinIO 자격 증명, 포털 소스 mount를 갖지 않습니다.
- 각 호출은 입력만 있는 임시 디렉터리에서 read-only sandbox, approval `never`, shell tool과 web search 비활성 상태로 실행됩니다.
- 임시 재인코딩 이미지는 매 호출 직후 삭제됩니다.
- 허용할 외부 도메인은 VPS 방화벽/egress proxy에서 Codex/ChatGPT 인증 및 추론 endpoint로 제한합니다. Compose만으로 DNS 기반 allowlist를 흉내 내지 않습니다.
- 어댑터 동시 실행은 1개, timeout은 75초입니다. 워커가 최대 3회 지수 backoff하고 끝내 실패하면 `NEEDS_REVIEW`로 전환합니다.
