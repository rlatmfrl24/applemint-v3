# Applemint P0 배포 절차

이 변경은 기존 테이블을 삭제하지 않습니다. DB migration과 환경 변수를 먼저 준비한 뒤 Next와 Edge를 연속 배포하며, 전환 중에는 수동 크롤링을 실행하지 않습니다.

## 1. 사전 검증

```powershell
pnpm test
pnpm test:db
pnpm typecheck
pnpm check:edge
pnpm test:edge
pnpm build
```

Next 런타임에는 다음 값을 설정합니다.

- `CRAWL_ALLOWED_USER_IDS`: 수동 크롤링 허용 사용자 UUID를 쉼표로 구분
- `CRAWL_INTERNAL_SECRET`: 임의 생성한 32바이트 이상의 값
- `SUPABASE_SERVICE_ROLE_KEY`: 서버 전용 키
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Edge Function에는 같은 `CRAWL_INTERNAL_SECRET`과 `CRAWL_API_BASE_URL`, `NEXT_PUBLIC_IMGUR_CLIENT_ID`를 설정합니다. secret 값은 명령 기록이나 문서에 남기지 않습니다.

## 2. 원격 baseline과 migration history 정렬

`20260310080000_remote_schema_baseline.sql`은 데이터·소유자 정보 없이 추출한 기존 원격 `public` 스키마입니다. 아래 두 migration의 객체가 원격에 이미 존재하는지 먼저 확인합니다.

```powershell
supabase migration list
supabase db diff --linked --schema public
```

baseline과 기존 `20260310090000` 객체가 실제로 존재하고 원격 migration history에만 누락된 경우에 한해 적용 상태로 정렬합니다.

```powershell
supabase migration repair --status applied 20260310080000
supabase migration repair --status applied 20260310090000
```

이 확인 없이 `migration repair`를 실행하면 실제 스키마와 이력이 달라질 수 있으므로 중단해야 합니다.

## 3. DB와 애플리케이션 배포

```powershell
supabase db push
supabase functions deploy crawl-source
```

`supabase/config.toml`의 `verify_jwt = true`를 유지합니다. 이어서 같은 `CRAWL_INTERNAL_SECRET`이 설정된 Next 배포를 완료합니다.

## 4. 배포 후 확인

1. `anon`이 `move_thread`, `bulk_move_new_threads_to_trash`, `ingest_crawl_items`를 실행할 수 없는지 확인합니다.
2. `authenticated`는 이동 RPC만, `service_role`은 ingest/lock RPC만 실행 가능한지 확인합니다.
3. 네 소스를 한 번씩 실행해 `insertedCount`, `skippedCount`, `warningCount`, `durationMs`를 확인합니다.
4. 두 번째 실행에서 중복 URL이 `skippedCount`로 집계되는지 확인합니다.
5. `crawl_run_locks`에 global lock이 남아 있지 않은지 확인합니다.
6. Quick Save, Trash, Quick Save→Trash, Restore, 모두 휴지통으로 이동을 브라우저에서 확인합니다.

문제가 발생하면 Next와 Edge를 함께 이전 버전으로 되돌립니다. 추가된 컬럼·함수·잠금 테이블은 이전 코드와 충돌하지 않으므로 즉시 제거하지 않습니다.
