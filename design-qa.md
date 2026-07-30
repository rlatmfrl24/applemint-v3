# Design QA — Applemint 1안 민트 링크 루프

## 기준과 증거

- 원본 시각 기준: [source-concept.png](docs/assets/brand/qa/source-concept.png)
- 브라우저 구현 화면: [option-1-browser-dark.png](docs/assets/brand/qa/option-1-browser-dark.png)
- 전체 화면 비교: [option-1-full-comparison.png](docs/assets/brand/qa/option-1-full-comparison.png)
- 집중 영역 비교: [option-1-focused-comparison.png](docs/assets/brand/qa/option-1-focused-comparison.png)
- 라이트·다크·축소 비교: [option-1-svg-qa-board.png](docs/assets/brand/qa/option-1-svg-qa-board.png)
- 라이트 SVG 브라우저 캡처: [option-1-light-svg-browser.png](docs/assets/brand/qa/option-1-light-svg-browser.png)

## 환경과 정규화

- 원본 시안: 1536×1024 px
- 브라우저 구현: 1280×720 px, CSS viewport 1280×720, DPR 1
- 확인 상태: `/login`, 다크 테마, 기본 상태
- 헤더 마크: 원본 SVG 421×352 viewBox, 화면 38.266×32 CSS px
- 집중 비교는 원본 마크 영역과 최종 SVG를 421×352 비율로 맞춘 뒤 동일 크기로 렌더했습니다.
- 전체 비교는 브랜드 보드와 실제 앱 화면의 목적이 달라 구성 일치가 아닌 로고 형태와 화면 내 비례를 확인하는 증거로 사용했습니다.

## Findings

- P0/P1/P2 잔여 항목 없음.
- 글꼴과 타이포그래피: 앱의 기존 Geist 워드마크와 글자 크기, 굵기, 자간을 유지했습니다.
- 간격과 레이아웃: 로고 높이 32px와 기존 10px 간격을 유지하고, 가로형 마크에 맞춰 너비만 38px로 조정했습니다.
- 색상과 토큰: 라이트는 `#111827`·`#0D9488`, 다크는 `#F8FAFC`·`#2DD4BF`를 사용합니다. 앱의 `.dark` 클래스에 따라 전용 SVG가 전환됩니다.
- 이미지 품질: 기준 SVG는 2개 채움 경로, 1,629 bytes이며 이미지·마스크·필터·그라데이션을 사용하지 않습니다.
- Maskable 안전 영역: 512px 아이콘의 전경을 중심 반경 204.8px 안에 배치했습니다.
- 카피와 콘텐츠: `Applemint` 워드마크와 로그인 화면 문구를 변경하지 않았습니다.
- 접근성과 동작: 기존 홈 링크와 접근 가능한 이름을 유지했습니다. 브라우저 콘솔 `warn`·`error`는 0건입니다.
- 축소 가시성: 64px, 32px, 16px의 라이트·다크 배경에서 두 루프와 내부 여백이 구분됩니다.

## 비교 이력

1. 첫 추출본은 곡선 보간 과정에서 우측 끝과 하단 모서리가 과도하게 둥글어지는 P2 형태 차이가 있었습니다.
2. 원본 윤곽의 직각 전환점을 보존하고 곡선 구간만 평활화해 시안의 사각 끝과 넓은 내부 여백을 복원했습니다.
3. 시스템 색상 설정만 따르는 단일 SVG는 앱에서 수동으로 선택한 테마와 어긋날 수 있는 P2 위험이 있었습니다.
4. 헤더에 라이트·다크 전용 SVG를 제공하고 Tailwind `dark` 상태로 교체하도록 수정했습니다. 실제 다크 화면에서 라이트 자산은 `display: none`, 다크 자산은 38.266×32 px로 렌더되는 것을 확인했습니다.
5. 후속 비교에서 원본 실루엣, 라이트·다크 대비, 16px 축소 상태에 추가 P0/P1/P2 차이가 없었습니다.

## 코드 검증

- `pnpm check`: 통과
- `pnpm exec vitest run app/manifest.test.ts app/main/layout.test.tsx public/sw.test.ts`: 3개 파일, 14개 테스트 통과
- `pnpm build`: 통과
- SVG XML·구조 검사: 모든 자산 파싱 통과, 경로 2개, 이미지·마스크·필터·그라데이션 0개
- PWA PNG 크기 검사: 192, 512, maskable 512, Apple Touch 180, badge 96 통과
- Maskable 픽셀 안전 영역 검사: 전경 최대 반경이 204.8px 이하임을 확인

## Follow-up Polish

- 원본 시안의 그라데이션과 그림자는 SVG 단순성·축소 가시성·테마 대비를 위해 의도적으로 제외했습니다.

final result: passed
