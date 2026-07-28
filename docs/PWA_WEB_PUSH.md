# PWA 설치·Web Push 운영 가이드

## 제공 범위

- `/main`을 시작 화면으로 사용하는 standalone PWA
- 일반 192/512 아이콘, maskable 512 아이콘, Apple Touch Icon, Android 알림 badge
- 예약 수집의 `succeeded`·`partial` 실행에서 신규 아이템이 1개 이상 생긴 경우 실행별 알림 1건
- 기기별 마지막 Inbox 확인 이후 예약 수집 신규 아이템 누적 badge
- Push·Notification·Badge만 처리하고 `fetch`를 가로채지 않는 서비스 워커

수동 수집 알림, 아이템 제목 노출, 크롤러 장애 알림, 오프라인 데이터 캐시는 이 범위에 포함하지
않습니다.

## 2026-07-28 운영 반영 상태

- Vercel Production에 `WEB_PUSH_ENABLED`, VAPID keypair, `VAPID_SUBJECT`가 등록되어 있고
  `WEB_PUSH_ENABLED=true` 배포가 `Ready` 상태입니다.
- 운영 별칭은 `https://applemint-v3.vercel.app`이며 manifest, 서비스 워커, 설치·알림 아이콘의
  운영 응답을 확인했습니다.
- Supabase production migration과 구독 사용자 인덱스가 적용됐습니다.
- `applemint-dispatch-web-push`와 `applemint-clean-web-push` Cron은 각각 1개씩 활성화되어 있고
  dispatcher의 첫 5분 실행이 성공했습니다.
- 아직 사용자가 알림을 활성화한 기기가 없어 구독과 delivery는 0건입니다. 아래 기기별 수동
  절차부터 수행하면 실제 발송 검증을 시작할 수 있습니다.

## 서버 환경 변수

다음 값은 Vercel의 서버 환경 변수로만 관리합니다. `VAPID_PUBLIC_KEY`도 브라우저 bundle에 직접
넣지 않고 로그인한 소유자의 `push.configuration` API를 통해서만 전달합니다.

- `WEB_PUSH_ENABLED`: 기본값은 `false`; 정확히 `true`일 때만 신규 구독과 발송을 활성화
- `VAPID_PUBLIC_KEY`: URL-safe base64 P-256 public key
- `VAPID_PRIVATE_KEY`: URL-safe base64 P-256 private key
- `VAPID_SUBJECT`: 운영 연락처인 `mailto:` 또는 HTTPS URL
- `CRAWL_INTERNAL_SECRET`: 기존 예약 수집과 공유하는 32바이트 이상 내부 secret

VAPID key는 아래 명령으로 한 번 생성하고 password manager와 Vercel에 저장합니다. 출력값과
private key를 저장소, 로그, 이슈, PR 본문에 복사하지 않습니다.

```powershell
pnpm exec web-push generate-vapid-keys
```

Supabase Vault의 기존 값도 그대로 사용합니다.

- `crawl_app_base_url`: 운영 애플리케이션 origin
- `crawl_internal_secret`: Vercel `CRAWL_INTERNAL_SECRET`과 같은 값

## 배포 순서

1. migration을 적용해 구독·delivery RLS 테이블, RPC, 5분 dispatcher Cron, 90일 cleanup Cron을
   배포합니다.
2. 애플리케이션을 `WEB_PUSH_ENABLED=false`로 먼저 배포합니다.
3. `/manifest.webmanifest`, `/sw.js`, PNG 아이콘의 200 응답과 서비스 워커 header를 확인합니다.
4. VAPID 환경 변수와 기존 internal secret·Vault 값을 확인합니다.
5. `WEB_PUSH_ENABLED=true`로 전환한 뒤 `/main/setting/app`에서 테스트 기기 구독을 활성화합니다.
6. 예약 수집으로 신규 아이템을 만들고 10분 안에 알림 1건과 누적 badge를 확인합니다.

delivery가 없으면 DB Cron은 `/api/push/dispatch` 외부 요청을 만들지 않습니다. dispatcher는 한 번에
20건을 claim하고 동시에 최대 5건을 발송합니다. 네트워크 오류, 408, 429, 5xx는 1분, 5분, 30분,
2시간, 6시간 간격으로 재시도하며 생성 후 24시간 또는 최대 재시도를 넘기면 `dead`가 됩니다.
404·410은 해당 기기 구독만 비활성화합니다.

## Rollback

긴급 중단은 Vercel의 `WEB_PUSH_ENABLED=false` 설정 후 재배포합니다. 신규 구독과 실제 발송은
중단되지만 기존 웹 기능과 설치 앱은 계속 동작합니다. 서비스 워커에는 `fetch` handler가 없으므로
인증 응답이나 사용자 데이터를 캐시하지 않습니다.

DB 구조를 즉시 되돌릴 필요는 없습니다. `delivered`, `skipped`, `dead` delivery와 장기 비활성
구독은 매일 cleanup에서 90일 후 제거됩니다.

## 운영자가 직접 수행할 작업

서버 배포가 끝난 뒤에도 브라우저의 설치·알림 권한은 보안상 서버에서 대신 승인할 수 없습니다.
아래 기기별 절차와 실제 예약 수집 알림 수신 확인은 Applemint 소유자가 직접 수행해야 합니다.

### 공통 사전 확인

1. 운영 URL `https://applemint-v3.vercel.app`에 Applemint 소유자 계정으로 로그인합니다.
2. 운영체제에서 해당 브라우저의 알림이 허용되어 있는지 확인합니다.
3. 브라우저의 사이트 설정에서 Applemint 알림이 기존에 `차단`되어 있지 않은지 확인합니다.
4. `/main/setting/app`을 열어 `앱 및 알림` 화면이 표시되는지 확인합니다.
5. 알림 권한은 반드시 이 화면의 `알림 활성화` 버튼으로 요청합니다. 페이지 진입만으로 권한
   팝업이 나타나지는 않는 것이 정상입니다.

권한을 한 번 거부하면 브라우저 정책상 앱이 자동으로 다시 묻지 않습니다. 이 경우 브라우저 또는
운영체제 설정에서 권한을 직접 `허용`으로 바꾼 뒤 앱 화면을 다시 엽니다.

### Android Chrome

1. Chrome에서 운영 URL을 열고 로그인합니다.
2. `/main/setting/app`의 설치 영역에서 `설치`를 누릅니다.
3. Chrome의 설치 확인 창에서 `설치`를 선택합니다.
4. 홈 화면 또는 앱 목록에 생긴 Applemint 아이콘으로 앱을 다시 엽니다.
5. 주소창이 없는 standalone 창으로 열리고 설치 상태가 `설치됨`인지 확인합니다.
6. 같은 화면에서 `알림 활성화`를 누르고 Android/Chrome 알림 요청을 `허용`합니다.
7. 상태가 `활성화`로 바뀌는지 확인합니다.
8. 아이콘을 길게 눌러 앱 정보의 알림 권한도 `허용`인지 확인합니다.

설치 버튼이 나타나지 않으면 Chrome 메뉴의 `홈 화면에 추가` 또는 `앱 설치`를 사용합니다. 이미
설치되어 있거나 브라우저의 설치 조건 판단이 끝나지 않은 경우 버튼 대신 안내 문구가 표시될 수
있습니다.

### iPhone·iPad

iOS/iPadOS Web Push는 홈 화면에 설치한 웹 앱에서만 활성화합니다. 일반 Safari 탭에서 알림
활성화를 시도하지 않습니다.

1. iOS/iPadOS 16.4 이상 기기의 Safari에서 운영 URL을 열고 로그인합니다.
2. Safari의 `공유` 버튼을 누릅니다.
3. 공유 시트에서 `홈 화면에 추가`를 선택합니다. 항목이 보이지 않으면 `동작 편집`에서
   추가합니다.
4. 이름과 아이콘을 확인하고 우측 상단의 `추가`를 누릅니다.
5. Safari 탭을 닫고 홈 화면의 Applemint 아이콘으로 앱을 실행합니다.
6. `/main/setting/app`에서 설치 상태가 `설치됨`인지 확인합니다.
7. `알림 활성화`를 직접 누르고 시스템 알림 요청을 `허용`합니다.
8. iOS `설정 → 알림 → Applemint`에서 `알림 허용`, 잠금 화면, 알림 센터, 배너가 원하는
   방식으로 켜져 있는지 확인합니다.

권한을 거부했다면 iOS `설정 → 알림 → Applemint`에서 직접 허용합니다. 앱 설정 항목이 생성되지
않았으면 홈 화면 앱을 삭제하고 다시 추가한 뒤 위 절차를 반복합니다.

### Desktop Chrome·Edge

1. Chrome 또는 Edge에서 운영 URL을 열고 로그인합니다.
2. `/main/setting/app`의 `설치`를 누릅니다. 버튼이 없으면 주소창 우측의 앱 설치 아이콘 또는
   브라우저 메뉴의 `앱 설치`를 사용합니다.
3. 설치된 Applemint 창이 독립된 앱 창으로 열리는지 확인합니다.
4. `/main/setting/app`에서 `알림 활성화`를 누르고 브라우저 권한을 `허용`합니다.
5. Windows `설정 → 시스템 → 알림`에서 Chrome/Edge 또는 Applemint 알림이 켜져 있는지
   확인합니다.
6. 설치 창을 닫았다가 시작 메뉴의 Applemint로 다시 실행해 설치 상태와 아이콘을 확인합니다.

### 예약 수집 알림 확인

1. 테스트 기기에서 알림 상태를 `활성화`로 만듭니다.
2. 테스트 중에는 Inbox(`/main`)를 열지 않고 앱을 백그라운드로 보내거나 종료합니다.
3. 다음 **예약 수집**이 완료될 때까지 기다립니다. 수동 수집은 이 기능의 발송 대상이 아닙니다.
4. 해당 실행이 `succeeded` 또는 `partial`이고 신규 아이템이 1개 이상이어야 합니다.
5. 수집 완료 후 dispatcher 주기를 고려해 최대 10분 기다립니다.
6. `Applemint 새 아이템` 알림이 소스별 실행당 1건만 도착하는지 확인합니다.
7. 본문에는 소스 이름과 개수만 있고 아이템 제목이나 원문 URL이 없는지 확인합니다.
8. 알림을 누르면 기존 Applemint 창이 `/main`으로 이동해 포커스되거나 새 앱 창이 열리는지
   확인합니다.

신규 아이템이 0개인 실행, `failed`·중단 실행, 사용자가 직접 시작한 수동 수집에는 알림이 오지
않는 것이 정상입니다. 실제 사이트에 신규 글이 없어 검증할 수 없는 경우 DB에 임의 delivery를
삽입하지 말고 다음 예약 수집을 기다립니다.

### Badge 누적·초기화 확인

1. Inbox를 열지 않은 채 신규 아이템이 있는 예약 수집을 2회 이상 기다립니다.
2. 설치 앱 아이콘의 badge가 각 실행의 `insertedCount` 합계로 누적되는지 확인합니다.
3. Inbox(`/main`)를 열고 첫 페이지가 오류 없이 표시될 때까지 기다립니다.
4. 서버 acknowledge가 성공하면 해당 기기의 badge가 0으로 초기화되는지 확인합니다.
5. 두 기기에서 각각 알림을 활성화한 경우, 한 기기에서만 Inbox를 열어 다른 기기의 badge가
   유지되는지 확인합니다.
6. 두 번째 기기에서도 Inbox를 연 뒤 그 기기의 badge만 0이 되는지 확인합니다.

일부 Android 런처는 Badging API 숫자 대신 점 또는 시스템이 관리하는 표시만 보여 줍니다. 이는
브라우저·런처 동작이며 서버의 누적 계산 오류가 아닐 수 있습니다.

### 비활성화·권한 차단 확인

1. `/main/setting/app`에서 알림을 비활성화합니다.
2. 상태가 미활성화로 바뀌고 현재 앱 아이콘 badge가 지워지는지 확인합니다.
3. 이후 예약 수집에서 해당 기기로 알림이 오지 않는지 확인합니다.
4. 다시 활성화하면 활성화 이전의 과거 아이템을 badge에 포함하지 않는지 확인합니다.
5. 브라우저 설정에서 알림을 차단한 뒤 화면이 `차단` 상태와 설정 안내를 표시하는지 확인합니다.
6. 알림 상태와 무관하게 로그인, Inbox, 수집 등 기존 Applemint 기능이 계속 동작하는지
   확인합니다.

## 장애 확인표

| 화면 또는 증상 | 확인할 항목 | 조치 |
| --- | --- | --- |
| `서버 설정 중단` | `WEB_PUSH_ENABLED`, VAPID 3개 변수, 최신 Production 배포 | 값을 고친 뒤 반드시 Production 재배포 |
| `설치 필요` | iPhone/iPad에서 홈 화면 앱으로 실행했는지 | Safari 공유 메뉴로 홈 화면에 추가 후 아이콘으로 재실행 |
| `차단` | 브라우저 사이트 권한과 OS 알림 권한 | 설정에서 수동 허용 후 앱 재실행 |
| `미지원` | 브라우저의 Service Worker·Push API 지원 | 최신 Chrome/Edge 또는 iOS/iPadOS 16.4+ 홈 화면 앱 사용 |
| `활성화`지만 알림 없음 | 예약 실행 여부, 신규 개수, 실행 상태, 10분 대기 여부 | 수동·0건·실패 실행을 제외하고 다음 예약 실행으로 재검증 |
| 알림은 오지만 badge 숫자가 없음 | OS·브라우저·런처의 Badging API 지원 | 알림 수신과 Inbox acknowledge를 기준으로 확인 |
| 알림 클릭 시 로그인 화면 | 세션 만료 여부 | 다시 로그인하면 `/main`으로 복귀 |

## 환경 변수 유지보수 매뉴얼

현재 값은 Vercel의 Production 환경에 저장하고 저장소에는 넣지 않습니다. 이후 운영자가 직접
복구하거나 key를 교체할 때는 다음 순서를 따릅니다.

1. Vercel Dashboard에서 `applemint-v3 → Settings → Environment Variables`를 엽니다.
2. 대상 환경을 `Production`으로 지정합니다.
3. `WEB_PUSH_ENABLED=false`로 바꾸고 Production을 재배포해 발송을 먼저 멈춥니다.
4. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`를 확인하거나 새 값으로
   교체합니다.
5. `CRAWL_INTERNAL_SECRET`은 Supabase Vault의 `crawl_internal_secret`과 동일해야 합니다.
6. 새 Production 배포가 성공한 뒤 `WEB_PUSH_ENABLED=true`로 바꾸고 다시 재배포합니다.
7. `/main/setting/app`이 서버 중단 상태가 아닌지 확인합니다.

Vercel CLI를 사용할 때도 값이 shell history나 로그에 남지 않게 주의합니다.

```powershell
# 상태만 중단/활성화할 때
'false' | pnpm dlx vercel@latest env update WEB_PUSH_ENABLED production --yes
pnpm dlx vercel@latest deploy --prod --yes

'true' | pnpm dlx vercel@latest env update WEB_PUSH_ENABLED production --yes
pnpm dlx vercel@latest deploy --prod --yes
```

VAPID keypair를 교체하면 기존 브라우저 구독으로는 새 key를 사용할 수 없습니다. 이때는 기능을
중단한 상태에서 public/private key를 한 쌍으로 교체하고 재배포한 뒤, 각 기기에서 알림을
비활성화하고 다시 활성화해야 합니다. 현재 Vercel에서 `Sensitive`로 저장한 값은 다시 조회할 수
없으므로 잃어버렸다면 기존 값을 추측하지 말고 새 keypair로 회전합니다.

## 운영 데이터 확인

Supabase Dashboard의 SQL Editor에서 다음 read-only query로 상태를 확인할 수 있습니다. endpoint,
`p256dh`, `auth`는 개인정보·구독 비밀이므로 조회하거나 운영 로그에 남기지 않습니다.

```sql
select active, count(*) as subscription_count
from public.web_push_subscriptions
group by active
order by active desc;

select state, count(*) as delivery_count
from public.web_push_deliveries
group by state
order by state;

select jobname, schedule, active
from cron.job
where jobname in (
  'applemint-dispatch-web-push',
  'applemint-clean-web-push'
)
order by jobname;
```

장애 조사 시에도 delivery ID, 상태, 재시도 횟수, 안전한 오류 코드만 사용합니다. endpoint와 암호화
키는 SQL 결과, 화면 캡처, 로그, 이슈, 채팅에 복사하지 않습니다.

자동 Playwright·스모크 검증에는 이 흐름을 포함하지 않습니다.
