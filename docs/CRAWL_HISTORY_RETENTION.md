# 크롤링 이력 보존 정책

## 정책

`public."crawl-history"`는 운영 로그가 아니라 `(crawl_source, url)` 기준의 영구 중복 방지 집합이다. `threads`에서 사용자가 항목을 삭제해도 이력은 삭제하지 않으며, 같은 소스에서 같은 URL이 다시 발견되어도 재수집하지 않는다.

- 보존 기간: 영구
- 만료 처리: 삭제·아카이브 없음
- 삭제된 URL 재수집: 허용하지 않음
- 자동 정리: `crawl-history` 대상 RPC 또는 cron job 없음
- 파티셔닝: 적용하지 않음

PostgreSQL 15의 partitioned table에서 unique constraint는 모든 partition key를 포함해야 한다. `created_at` 월별 파티셔닝을 적용하면 현재 전역 유니크 키에 `created_at`을 추가해야 하므로, 같은 URL이 다른 월에 다시 적재될 수 있다. 현재 중복 방지 계약을 유지하기 위해 단일 테이블과 `idx_crawl_history_source_url_unique`를 사용한다.

## 운영 규모 측정

아래 쿼리는 읽기 전용이다. 배포 전후 Supabase SQL Editor에서 실행하고 결과와 실행 시각을 운영 기록에 남긴다.

### 전체·소스별 행 수와 기간

```sql
select
	count(*) as row_count,
	min(created_at) as first_created_at,
	max(created_at) as last_created_at,
	max(created_at) - min(created_at) as observed_period
from public."crawl-history";

select
	crawl_source,
	count(*) as row_count,
	min(created_at) as first_created_at,
	max(created_at) as last_created_at
from public."crawl-history"
group by crawl_source
order by row_count desc;
```

### 증가량과 단순 연간 예상치

```sql
select
	date_trunc('month', created_at) as month,
	count(*) as added_rows
from public."crawl-history"
group by 1
order by 1;

select
	count(*) filter (where created_at >= now() - interval '7 days') as rows_last_7_days,
	count(*) filter (where created_at >= now() - interval '30 days') as rows_last_30_days,
	count(*) filter (where created_at >= now() - interval '90 days') as rows_last_90_days,
	round(count(*) filter (where created_at >= now() - interval '30 days') / 30.0, 2) as daily_average_30_days,
	round(count(*) filter (where created_at >= now() - interval '30 days') / 30.0 * 365) as projected_rows_next_year
from public."crawl-history";
```

### 테이블·인덱스 용량

```sql
select
	pg_size_pretty(pg_relation_size('public."crawl-history"')) as table_size,
	pg_size_pretty(pg_indexes_size('public."crawl-history"')) as indexes_size,
	pg_size_pretty(pg_total_relation_size('public."crawl-history"')) as total_size;

select
	indexrelname as index_name,
	pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
	idx_scan,
	idx_tup_read,
	idx_tup_fetch
from pg_stat_user_indexes
where relid = 'public."crawl-history"'::regclass
order by pg_relation_size(indexrelid) desc;
```

`pg_stat_user_indexes`의 누적값은 통계 초기화 이후 기간만 나타내므로 측정 시각과 DB 재시작·통계 초기화 여부를 함께 기록한다. 행 수와 전체 용량의 추세를 월별로 비교하고, 저장 한도에 가까워지거나 아래 대표 조회가 더 이상 unique index를 사용하지 않을 때만 데이터 모델을 재검토한다.

## 백업과 복구

권한 migration 자체는 데이터를 삭제하지 않지만, 배포 전 다음 절차로 복구 가능성을 확인한다.

1. Supabase Dashboard에서 최신 자동 백업 또는 PITR 복구 지점과 보존 기간을 확인한다.
2. 저장소 밖의 접근 제한된 경로로 논리 백업을 생성한다. 이 파일에는 수집 URL이 포함되므로 암호화된 저장소에 보관한다.

```powershell
pnpm exec supabase db dump --linked --data-only --use-copy --schema public --file C:\secure-backups\applemint-public-YYYYMMDD.sql
```

3. 운영 프로젝트가 아닌 격리된 로컬 DB에서 migration을 적용한다. `db reset`은 지정한 로컬 DB의 데이터를 지우므로 `supabase status`에서 대상이 로컬 프로젝트인지 먼저 확인한다.

```powershell
pnpm exec supabase db reset --local --no-seed
```

4. data-only dump를 재생하기 전에 migration이 생성한 singleton 행을 포함해 로컬 `public` 데이터를 모두 비운다. 아래 URL은 이 프로젝트의 고정된 loopback 로컬 DB 주소이며, 원격 또는 linked DB 주소로 바꾸지 않는다.

```powershell
$restoreDbUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
$restoreDbUri = [Uri]$restoreDbUrl
if ($restoreDbUri.Host -notin @("127.0.0.1", "localhost") -or $restoreDbUri.Port -ne 54322) {
	throw "복원 검증은 loopback 로컬 DB의 54322 포트에서만 실행할 수 있습니다."
}
$emptyPublicDataSql = @'
do $$
declare
	table_list text;
begin
	select string_agg(format('%I.%I', schemaname, tablename), ', ')
	into table_list
	from pg_tables
	where schemaname = 'public';

	if table_list is not null then
		execute 'truncate table ' || table_list || ' restart identity cascade';
	end if;
end
$$;
'@
psql $restoreDbUrl --set ON_ERROR_STOP=on --command $emptyPublicDataSql
psql $restoreDbUrl --set ON_ERROR_STOP=on --file C:\secure-backups\applemint-public-YYYYMMDD.sql
```

전체 `public` 데이터와 identity 값을 비운 뒤 복원하므로 migration에 포함된 초기 행과 data-only dump가 충돌하지 않는다. `ON_ERROR_STOP`은 duplicate key 등 첫 SQL 오류에서 복원을 즉시 중단한다.

5. 원본과 복원본에서 다음 검증 쿼리를 실행해 전체·소스별 행 수와 기간이 일치하는지 확인한다.

```sql
select
	crawl_source,
	count(*) as row_count,
	min(created_at) as first_created_at,
	max(created_at) as last_created_at
from public."crawl-history"
group by crawl_source
order by crawl_source;
```

복원이 검증되지 않았거나 백업 시점을 확인할 수 없으면 배포를 중단한다. 예기치 않은 history 손실은 신규 크롤링을 중지한 뒤 PITR 또는 검증된 논리 백업으로 복구하고, 전체·소스별 행 수를 다시 대조한다.

## 배포 후 성능 검증

먼저 실제 존재하는 URL 하나를 선택한다.

```sql
select crawl_source, url
from public."crawl-history"
order by created_at desc
limit 1;
```

아래 값들을 위 결과로 바꾼 뒤 실행한다. 실행 계획에서 `idx_crawl_history_source_url_unique`를 사용하는 `Index Only Scan` 또는 `Index Scan`과 1행 이하 결과를 확인한다.

```sql
explain (analyze, buffers)
select url
from public."crawl-history"
where crawl_source = '실제 crawl_source'
	and url = '실제 url';
```

마지막으로 다음 불변 조건을 확인한다.

```sql
select
	to_regclass('public.idx_crawl_history_source_url_unique') is not null as unique_index_exists,
	count(*) = count(distinct (crawl_source, url)) as has_no_duplicates
from public."crawl-history";

select jobname, schedule, command
from cron.job
where command ilike '%crawl-history%';
```

첫 쿼리는 두 값이 모두 `true`, 두 번째 쿼리는 0행이어야 한다. 기존 `applemint-clean-crawl-runs` 작업은 `crawl_runs`와 관련 알림 이력만 90일 후 정리하며 `crawl-history`에는 접근하지 않는다.
