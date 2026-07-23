# `threads` 단일화 배포·관찰 절차

## 현재 단계

`20260722180000_unify_threads_expand.sql`은 expand migration이다. `threads`를 정본으로 만들고 기존 `new-threads`, `quick-save`, `trash`는 단방향 동기화되는 롤백용 투영본으로 유지한다. 레거시 테이블의 직접 DML은 지원하지 않는다.

상태 매핑은 다음과 같다.

| 기존 테이블 | `threads.state` |
| --- | --- |
| `new-threads` | `inbox` |
| `quick-save` | `saved` |
| `trash` | `trash` |

`created_at`은 논리 스레드 생성 시각, `captured_at`은 최초 수집 시각, `state_changed_at`은 현재 상태 진입 시각이다. 상태 이동은 `transition_thread_state`의 조건부 단일 `UPDATE`로 수행하며 ID를 바꾸지 않는다.

## 적용 전 게이트

1. 크롤러·스케줄러가 7일 연속 정상이고 열린 incident가 없어야 한다.
2. PITR 또는 최신 백업 시점을 확인하고 data-only dump를 격리된 로컬 DB에 복원한다.
3. 복원 DB에서 `supabase db reset --local --no-seed`, dump 복원, migration 적용, `pnpm test:db`를 수행한다.
4. 세 레거시 테이블 사이에 중복 ID가 없는지 확인한다. migration도 중복을 발견하면 전체 트랜잭션을 중단한다.

## 배포 순서

1. expand migration을 먼저 적용한다.
2. 현재 배포판에서 목록, 수집, Main→Quick Save→Trash→Restore와 일괄 이동을 스모크 테스트한다.
3. `/api/threads`와 TanStack Query 상태 기반 클라이언트가 포함된 앱을 배포한다.
4. 아래 관찰 기준을 7일 연속 충족한다. 문제가 발생하면 수정 배포 시점부터 7일을 다시 센다.
5. 기준 충족 후 별도 cleanup PR에서 동기화 트리거와 세 레거시 물리 테이블을 제거한다. 호환 RPC·HTTP 별칭은 유지한다.

## 관찰 쿼리와 기준

서비스 역할로 다음 RPC를 호출한다.

```sql
select * from public.get_thread_storage_consistency();
```

모든 상태에서 `canonical_count = legacy_count`, `mismatch_count = 0`이어야 한다. 함께 확인할 운영 기준은 다음과 같다.

- 이동 전후 동일 ID 유지
- inbox 적재와 `crawl-history` claim 정상
- API `4xx/5xx` 비율 무증가
- 레거시 동기화 불일치 0건
- `idx_threads_state_changed_at_id`, `idx_threads_state_type_changed_at_id` 사용

## 롤백과 cleanup 경계

관찰 기간 중 앱 롤백은 기존 HTTP·RPC 별칭을 사용하는 현재 배포판으로 수행한다. 레거시 테이블은 `threads`에서 동기화된 투영본이므로 직접 수정하지 않는다. 데이터 불일치가 있으면 이동·수집 쓰기를 중단하고 PITR 또는 검증된 논리 백업으로 복구한다.

cleanup은 이 expand migration에 포함하지 않는다. cleanup PR은 배포 직전 일치 검사를 다시 수행하고, 동기화 트리거 제거와 레거시 테이블 삭제를 하나의 별도 migration으로 제공해야 한다.
