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

Supabase Dashboard의 **Authentication > Providers**에서 신규 가입을 비활성화하고, **Authentication > Users**에 개인 계정 한 명만 존재하는지 확인합니다. 해당 사용자의 UUID가 `20260720130000_single_owner_rls.sql`에 고정된 UUID와 일치하지 않으면 배포를 중단하고, 기존 migration을 수정하지 말고 소유자 교체용 migration을 새로 작성합니다.

```powershell
supabase db push
supabase functions deploy crawl-source
```

`supabase/config.toml`의 `verify_jwt = true`와 Auth signup 비활성화 설정을 유지합니다. 이어서 같은 `CRAWL_INTERNAL_SECRET`이 설정된 Next 배포를 완료합니다. 새 애플리케이션 배포가 정상임을 확인한 뒤 Vercel의 기존 `CRAWL_ALLOWED_USER_IDS` 환경 변수는 삭제합니다.

## 4. 배포 후 확인

1. `anon`이 모든 업무 테이블을 조회·변경하거나 업무 RPC를 실행할 수 없는지 확인합니다.
2. 비소유자 JWT가 세 스레드 테이블을 조회할 수 없고 이동·통계 RPC에서 `42501`을 받는지 확인합니다.
3. 소유자는 세 스레드 테이블을 조회할 수 있지만 직접 `INSERT/UPDATE/DELETE`할 수 없고 이동 RPC만 실행 가능한지 확인합니다.
4. `service_role`만 history·filter·lock 테이블과 ingest/lock/clean RPC를 사용할 수 있는지 확인합니다.
5. 네 소스를 한 번씩 실행해 `insertedCount`, `skippedCount`, `warningCount`, `durationMs`를 확인합니다.
6. 두 번째 실행에서 중복 URL이 `skippedCount`로 집계되고 `crawl_run_locks`에 global lock이 남지 않는지 확인합니다.
7. 개인 계정으로 Main, Quick Save, Trash를 조회하고 Main→Quick Save→Trash→Restore 및 모두 휴지통으로 이동을 확인합니다.

문제가 발생하면 Next와 Edge를 함께 이전 버전으로 되돌립니다. 추가된 컬럼·함수·잠금 테이블은 이전 코드와 충돌하지 않으므로 즉시 제거하지 않습니다.
