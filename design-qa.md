# 북마크 디자인 QA

final result: passed

기준 시안과 실제 구현을 함께 배치해 전체 화면과 원본 크기의 행·주소·상세를 비교했다. 아래 P2 세 건을 수정한 재비교에서 남은 P0/P1/P2 시각 결함은 발견하지 못했다.

## 비교 자료와 정규화

- 시각 기준: `docs/design/bookmark-ux-reference.html`, `reports/reference-1440.png` (1440×900), `reports/reference-390.png` (390×844), CSS viewport와 deviceScaleFactor 1이 일치하는 Chromium 캡처.
- 구현: 인앱 브라우저 `http://127.0.0.1:3000/main/bookmarks`, `reports/iab-implementation-1440.png` (1440×900), `reports/iab-implementation-390.png` (390×844). 인앱 브라우저는 JPEG로 내보내므로 파일 확장자와 달리 JPEG 인코딩이다. 픽셀 크기/CSS 크기/DPR 1을 대조했다.
- 전체 비교: `reports/design-comparison-desktop.html` → `reports/comparison-desktop-final.png`, `reports/design-comparison-mobile.html` → `reports/comparison-mobile-final.png`. 데스크톱은 각 0.5배, 모바일은 각 1배로 동일 배율이다. 별도 이미지를 보고 나란히 비교했다고 간주하지 않았다.
- 부분 비교: `reports/design-comparison-focus.html` → `reports/comparison-focus-final.png`. 두 캡처의 행·주소·상세를 1배로 표시했다.
- 추가 행렬: `reports/qa-{1440,1024,390}-{Dark,Light}-{list,detail,tree,settings,review,activity,save}.png`. 데스크톱 1440×900, 태블릿 1024×768, 모바일 390×844. 기본 데스크톱 8행 이상, 모바일 가로 넘침 없음.
- 상태: 소유자 로그인, 전체 목록과 기존 `수집 글 관리자 검증 1791961474275`의 상세. 시안 작성 뒤 추가된 QA 자료·사용 이력·이전 경로는 동적 데이터 차이다. 모바일 시안의 첫 행 배경은 예시 선택 상태이며 구현 캡처는 상세를 닫은 상태다. 상위 공통 내비게이션은 기존 제품을 유지한다.
- 인앱 기준 캡처의 자동 크기 조절본(1425×891 / 375×812)은 최종 비교에서 제외하고, 같은 시안의 정확한 1x 캡처를 사용했다.

## 비교 이력과 수정

1. 첫 비교: `reports/comparison-desktop.png`, `reports/comparison-mobile.png`.
   - [P2] 열린 상세의 행을 체크 선택과 별도로 구분할 수 없었다. ID 기반 `data-detail-selected`와 기존 accent 배경을 연결했다.
   - [P2] 모바일의 상세·메뉴 두 버튼이 제목 너비를 줄였다. 모바일은 44px 상세 버튼 하나를 표시하고, 상세 안에 명시적 `컬렉션 이동`을 제공했다. 체크박스의 터치 영역도 44px로 확대했다.
   - 테마 메뉴의 퇴장 중 캡처는 판정에서 제외하고 메뉴가 제거된 상태를 재캡처했다.
2. 재비교: 위 `*-final.png` 세 파일. 상세 선택 행 강조, 긴 제목의 두 줄 표시, 주소와 경로 분리, 전체 URL 줄바꿈·복사와 모바일 단일 진입을 확인했다. 관련 UI 회귀를 RED→GREEN으로 검증했다.
3. 추가 라이트 설정 비교: 예산 카드의 머리말·설명이 관심 주제 편집을 첫 화면 아래로 밀었다(P2). 머리말 중복과 여백을 줄이고 장부 설명을 상세 사용량 안으로 옮겼다. `reports/settings-before-compact.png` → `reports/settings-compact-light-final.png`, 관심 주제 제목 y=664에서 550 미만으로 이동하는 회귀 RED→GREEN과 입력 폼의 실제 노출을 확인했다.
4. 모션 회귀: Vaul의 더 구체적인 선택자가 모션 감소를 덮던 문제를 북마크 전용 선택자로 수정했다. `reports/qa-200pct-reduced-detail.png`와 키보드 초점 회귀로 이동 애니메이션 제거를 확인했다.

## 필수 시각 표면 판정

| 표면 | 판정 |
|---|---|
| 글꼴·위계 | 기존 Geist와 제품의 한글 fallback을 유지했다. 제목 14px/두 줄, 주소·경로 12px, 상세 제목 16px의 위계를 확인했다. 시안의 굵은 제목과 구현의 기존 medium 굵기 차이는 제품 토큰 재사용 결정에 따른다. |
| 간격·구조 | 컬렉션 240px, 상세 360px, 유동 목록과 독립 스크롤을 유지한다. 선택 시 목록 위치를 유지하고 1024px/390px에서는 Drawer로 전환한다. |
| 색상·토큰 | background/foreground/muted/accent/destructive를 재사용했다. 밝은 테마와 어두운 테마에서 본문·주소·선택·오류·비활성 상태를 읽을 수 있다. |
| 자산·아이콘 | 기존 실제 Applemint 로고와 Lucide 아이콘을 사용한다. 초기 시안의 로고 전체 이미지 축소 오류는 기존 브랜드 마크 경로로 정정했다. 대체 SVG 그림이나 임시 자산은 없다. |
| 문구·내용 | 추천 중/사이트 일치/AI 설정됨/직접 소속/저장 후 재조회 실패를 구분한다. 전체 URL·경로는 상세에서 확인하고 복사할 수 있다. |

## 동작·접근성 확인

- 키보드 상세 진입·닫기와 초점 복귀, 컬렉션 트리 방향키·Escape, 한글 조합 검색, 자동 추천 중 선택·저장만 잠금, 30초 뒤 수동 선택, 느린 코드 로딩의 모달 취소를 확인했다.
- 관심 주제의 즉시 표시·실패 입력 보존, 모델 통계 접기, 초기/갱신/추가 로딩·오류·빈 상태와 실제 저장/이동/휴지통/복원을 확인했다.
- 200% 상당 reflow는 CSS 720×450와 DPR 2, reduced-motion에서 검증했다. 운영체제/브라우저 메뉴 자체의 확대나 실제 휴대폰 키보드·스크린리더는 검증하지 않았다.
- 화면 행렬은 `pageerror`를 수집해 빈 배열을 확인한다. 표시 전용 Query의 queryFn 경고는 skipToken으로 수정했다. 인앱 비교 페이지의 실행 오류는 없다.
- 최종 독립 리뷰의 입력 소실 3건은 회귀 RED→GREEN 후 같은 화면 행렬을 다시 통과했다. `reports/edit-protection-final.png`에서 실제 보기 전환 확인과 계속 편집 시 입력 유지도 확인했다. 데스크톱 상세 진입 시 목록 버튼에 초점이 남는 기능 탐색 효율 minor는 후속 항목이다.

체크리스트: 기준/구현 함께 비교 완료 · P2 수정/재캡처 완료 · 5개 시각 표면 확인 완료 · 실제 화면 행렬/키보드/모션 감소 확인 완료. 남겨 둔 시각 P3 제안은 없다.
