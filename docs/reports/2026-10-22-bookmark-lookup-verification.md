# 북마크 저장 전 중복 확인 검증

2026-10-22 KST. 기준 커밋 `ab65efc`, 구현 브랜치 `codex/bookmark-duplicate-lookup`.

## 실제 동작

- Main·Quick·수집 글 휴지통·작업 기록이 사용하는 공통 저장창은 소유자 전용 `bookmark.lookup`을 먼저 실행한다.
- 기존 항목은 저장된 제목·URL·보관 상태와 기존 북마크/휴지통 이동 버튼을 표시한다. 추천 폼을 마운트하지 않아 추천 등록과 추천 결과 조회가 발생하지 않는다.
- 신규 URL만 기존 추천·저장을 진행한다. 조회 실패 시에는 재시도와 닫기만 제공한다.
- 창을 닫았다가 이전 요청이 끝나기 전에 다시 열어도 각 열기에 별도 조회를 사용한다. 이전 응답이 신규 열기의 폼을 활성화하지 않는다.
- 저장 시점의 기존 DB 잠금·중복 반환은 유지했다. 중복 조회는 기존 메모·태그·컬렉션·버전을 변경하지 않는다.
- 항목 이동은 `state`와 짧은 `bookmark` ID로 기존 상세 화면을 연다. 상세를 닫거나 북마크 탭으로 돌아가면 연결 상태를 해제하고, 미저장 편집은 기존 확인 절차로 보호한다.

## 실행 중 확인한 계획 수정

처음 계획했던 URL 전체 전달 방식은 유효한 긴 URL에서 실제로 실패했다. tRPC의 2048자 GET 제한은 전송 전 오류를 냈고, Supabase REST 필터는 8192자 URL에서 414를 반환했다. 이스케이프가 많은 URL을 검색 주소에 넣으면 페이지 요청 자체도 431로 실패했다.

이를 해결하기 위해 조회 경계만 변경했다.

- `bookmark.lookup`만 tRPC POST 본문을 사용한다. 다른 query의 GET 방식, batch 8개·URL 2048자 제한과 소유자 검사는 유지한다. 서버 method override도 lookup 경로에만 허용한다.
- 새 `public.bookmark_lookup(text)` RPC는 `SECURITY INVOKER`와 기존 소유자 RLS를 사용한다. authenticated만 실행할 수 있고 PUBLIC·anon·service_role 실행 권한은 없다.
- RPC는 `url_key` 정확 비교, 보관함 우선, 최근 수정 순, ID 순, `LIMIT 1`로 네 필드만 반환한다. DB 생성 타입은 격리된 검증 DB에서 재생성했다.
- 항목 이동에 ID를 사용하므로 검색 한도는 기존 200자를 유지했다. 긴 URL 전용 검색 정책이나 서버 요청 길이 확대는 추가하지 않았다.
- `20261022011857_bookmark_lookup.sql` 마이그레이션 1개가 추가됐다. 인덱스 생성·교체·고유 제약 추가는 없다.

기존 브라우저 테스트가 이미 저장된 링크에서도 추천 폼을 기대하던 가정은 새 요구와 충돌했다. 저장된 항목은 중복 안내로 검증하고, 추천 폼 검증은 실제 미저장 링크와 실제 완료 추천 기록을 사용하도록 입력 선택을 수정했다. 테스트를 위해 중복 차단이나 권한·예산 검사를 우회하지 않았다.

## 검증 결과

| 검증 | 결과 |
|---|---|
| `pnpm test` | 947 PASS, 기존 조건부 3 SKIP |
| `pnpm test:db` | 격리 DB의 32개 SQL 파일, 788 PASS |
| 신규 lookup SQL 검사 | 10 PASS: 정렬·동률·휴지통·미존재·8192자·권한·원본 보존·인덱스 유효성 |
| `pnpm check` | Biome·Knip·TypeScript PASS |
| `pnpm build` | production build·server boundary·bundle 검사 PASS |
| bookmarks + bookmark-recommend Playwright | 실제 소유자 로그인 포함 16 PASS, 조건부 4 SKIP |
| 기존 방문 기록·헤더/휴지통 이동 Playwright | 로그인 포함 3 PASS |
| 초기 번들 | `/main` 127.1 KiB gzip, 기준 대비 +0.5%, 기존 한도 이내 |

실제 UI에서 신규 저장, 중복 재열기, 북마크 휴지통 안내, ID로 도착한 상세 화면, 닫기·초점 복귀, 조회 실패 후 재시도, 기존 추천 결과 재조회와 제목 변경 보호를 확인했다. ASCII와 `%2F`가 많은 8192자 URL 모두 조회·저장·중복 안내·상세 이동을 통과했다. 중복 안내 동안 브라우저의 추천 요청이 0건이고 해당 원본의 추천 작업 수가 증가하지 않으며, DB의 기존 항목과 원본 수집 글 상태가 보존됨을 확인했다.

Mock과 실패 주입은 단위·오류·경합 회귀 검사를 보조했다. 정상 저장·중복·휴지통·긴 URL의 완료 근거는 실제 로컬 UI와 소유자 DB 읽기 결과다. 신규 SQL 검증용 입력은 transaction rollback으로 남기지 않았다.

## 조회 성능과 인덱스

실제 로컬 PostgreSQL 17.6의 `bookmarks_url_idx USING hash(url_key)`가 valid·ready 상태임을 확인했다. 추가 인덱스는 만들지 않았다. 339개 북마크가 있던 시점에 authenticated 소유자와 동일한 조건으로 측정했다.

| 측정 | 실행 시간 | 버퍼 |
|---|---:|---|
| RPC와 동일한 SELECT, 기존 URL | 0.117 ms | shared hit 12, 인덱스 스캔 단계 hit 3 |
| 실제 `bookmark_lookup` RPC, 기존 URL | 0.168 ms | shared hit 2 |
| 실제 `bookmark_lookup` RPC, 미존재 URL | 0.136 ms | shared hit 1 |

동일 SELECT의 실행 계획은 `Index Scan using bookmarks_url_idx` 후 일치 행을 정렬했다. RPC 자체의 EXPLAIN은 Function Scan을 표시한다. 세션에서 nested auto_explain 로드는 허용되지 않아 그 출력은 수집하지 않았다. 측정은 READ ONLY transaction에서 수행하고 rollback했으며, 인덱스 사용 강제나 통계·데이터 수정은 하지 않았다.

위 수치는 소규모 로컬 DB의 단일 조회 결과이며 인증·원본 글 조회·네트워크·화면 표시 시간을 포함하지 않는다. 운영 환경의 성능 개선율이나 부하 한계를 입증하는 수치는 아니다.

## 적용 순서와 한계

운영 적용 시 새 DB 마이그레이션을 먼저 적용한 뒤 애플리케이션을 배포해야 한다. RPC가 없는 상태에서는 선행 조회가 실패하고 저장창은 재시도 안내에 머문다. 마이그레이션은 기존 데이터와 저장 command를 수정하지 않는다.

이번 작업에서는 운영 DB 변경·배포·push·PR 생성은 실행하지 않았다. 유료 Jev 명시 실행 2건, 외부 링크 재검사 1건, 완료된 일회 이관 환경 검사 1건은 해당 opt-in 조건이 없어 건너뛰었다. URL의 추적 파라미터나 fragment를 제거하거나 같은 콘텐츠를 병합하는 정책은 추가하지 않았다.
