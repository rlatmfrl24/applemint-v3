# Applemint P0 배포 절차

단일 소유자 권한 migration은 기존 데이터를 유지하지만, 후속 `20260720144000_remove_media_youtube.sql`은 사용하지 않는 Media·YouTube 행과 `sub_url` 컬럼을 삭제합니다. 배포 중에는 수동 크롤링을 실행하지 않습니다.

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

- `CRAWL_INTERNAL_SECRET`: 임의 생성한 32바이트 이상의 값
- `CRAWL_EXECUTION_MODE`: 첫 호환 배포는 `edge`, 검증 후 `next`
- `SUPABASE_SERVICE_ROLE_KEY`: 서버 전용 키
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Edge Function에는 같은 `CRAWL_INTERNAL_SECRET`과 `CRAWL_API_BASE_URL`을 설정합니다. secret 값은 명령 기록이나 문서에 남기지 않습니다.

`CRAWL_INTERNAL_SECRET`과 `CRAWL_API_BASE_URL`은 Next 직접 실행 전환 후 1주간 rollback을 위해
유지합니다. 관찰 기간이 끝나기 전에는 Edge Function 또는 내부 `/api/crawl`을 제거하지 않습니다.

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

Supabase Dashboard의 **Authentication > Providers**에서 신규 가입을 비활성화하고, **Authentication > Users**에 개인 계정 한 명만 존재하는지 확인합니다. 해당 사용자의 UUID가 `20260720130000_single_owner_rls.sql`에 고정된 UUID와 일치하지 않으면 배포를 중단하고, 기존 migration을 수정하지 말고 소유자 교체용 migration을 새로 작성합니다.

```powershell
supabase functions deploy crawl-source
supabase db push
```

DB와 기존 Edge를 먼저 배포한 다음 `CRAWL_EXECUTION_MODE=edge`인 호환 Next 빌드를 배포합니다.
호환 경로가 정상인지 확인한 뒤 Vercel 환경 변수를 `next`로 변경하고 다시 배포합니다. 통계 RPC
시그니처가 변경되는 배포에서는 DB와 Next 사이의 간격을 최소화합니다. 전환 기간에는
`supabase/config.toml`의 `verify_jwt = true`와 Auth signup 비활성화 설정을 유지합니다.

새 배포가 정상임을 확인한 뒤 Edge Function의 기존 `NEXT_PUBLIC_IMGUR_CLIENT_ID`, `MEDIA_FETCH_CONCURRENCY` secret과 Vercel의 `CRAWL_ALLOWED_USER_IDS`, 미사용 `DATABASE_PASSWORD` 환경 변수를 삭제합니다.

## 4. 배포 후 확인

1. `anon`이 모든 업무 테이블을 조회·변경하거나 업무 RPC를 실행할 수 없는지 확인합니다.
2. 비소유자 JWT가 세 스레드 테이블을 조회할 수 없고 이동·통계 RPC에서 `42501`을 받는지 확인합니다.
3. 소유자는 세 스레드 테이블을 조회할 수 있지만 직접 `INSERT/UPDATE/DELETE`할 수 없고 이동 RPC만 실행 가능한지 확인합니다.
4. `service_role`만 history·filter·lock 테이블과 ingest/lock/clean RPC를 사용할 수 있는지 확인합니다.
5. 네 소스를 한 번씩 실행해 `insertedCount`, `skippedCount`, `warningCount`, `durationMs`를 확인합니다.
6. 두 번째 실행에서 중복 URL이 `skippedCount`로 집계되고 `crawl_run_locks`에 global lock이 남지 않는지 확인합니다.
7. 개인 계정으로 Main, Quick Save, Trash를 조회하고 Main→Quick Save→Trash→Restore 및 모두 휴지통으로 이동을 확인합니다.
8. `media`, `youtube` 타입 행과 분류 키워드가 0건이고 세 스레드 테이블에 `sub_url` 컬럼이 없는지 확인합니다.

Next 직접 실행에서 문제가 발생하면 `CRAWL_EXECUTION_MODE=edge`로 되돌린 호환 빌드를
재배포합니다. 크롤링 DB RPC와 스키마는 양쪽 경로가 공유하므로 이 전환만으로는 DB rollback을
수행하지 않습니다. 삭제된 행과 `sub_url` 값은 migration만으로 복구할 수 없으므로 배포 전
백업이 필요합니다.

## 5. Next 직접 실행 전환 완료

`CRAWL_EXECUTION_MODE=next`로 1주간 운영하면서 다음 항목을 확인합니다.

1. 네 소스를 각각 두 번 이상 실행하고 적재·중복 제외 결과를 확인합니다.
2. 동시 실행의 `409`, timeout의 `504`, 일반 소스 실패의 `502` 응답을 확인합니다.
3. 실행 이력 dashboard, parser 추세, crawler-health 알림이 정상 집계되는지 확인합니다.
4. 실패한 실행 뒤 `crawl_run_locks`에 global lock이 남지 않는지 확인합니다.

관찰 기간이 정상적으로 끝난 다음 별도 정리 배포에서 Supabase Edge Function `crawl-source`, 내부
`POST /api/crawl`, Edge/Deno 전용 helper와 테스트를 제거합니다. 이어서 Vercel과 Supabase에서
`CRAWL_INTERNAL_SECRET`, Edge의 `CRAWL_API_BASE_URL`을 제거하고 CI의 Edge 검사 명령도 정리합니다.

정리 이후 긴급 rollback이 필요하면 secret manager의 기존 값을 복원하고 이전 호환 Next 빌드와
Edge Function을 함께 재배포합니다.
