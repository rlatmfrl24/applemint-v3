# Applemint 브랜드 자산

## 선택 방향

- 선택 시안: `1안 · 민트 링크 루프`
- 의미: 두 개의 굵은 루프가 수집된 링크와 Applemint의 `a`를 함께 표현합니다.
- 원본 시안: [Applemint 1안 원본](assets/brand/qa/source-concept.png)
- 기준 자산: 원본 시안의 두 색상 영역을 추적·단순화한 `public/brand/applemint-mark.svg`

## SVG 원칙

- 두 개의 채움 경로만 사용하고 마스크, 필터, 그라데이션, 외부 리소스와 내장 이미지를 사용하지 않습니다.
- 넓은 내부 여백과 굵은 실루엣을 유지해 16px 파비콘에서도 형태가 구분되도록 합니다.
- 라이트 모드는 `#111827`·`#0D9488`, 다크 모드는 `#F8FAFC`·`#2DD4BF`를 사용합니다.
- SVG 내부의 `prefers-color-scheme` 미디어 쿼리로 라이트·다크 색상을 자동 전환합니다.
- 파비콘·화면 로고·PWA 아이콘은 모두 같은 벡터 경로에서 파생합니다.
- 독립형 워드마크: `Segoe UI` 우선, `Arial` 폴백

## 적용 자산

- `app/icon.svg`: 배경에 따라 색상이 전환되는 브라우저 SVG 파비콘
- `public/brand/applemint-mark.svg`: 모든 아이콘의 단일 벡터 기준 마크
- `public/brand/applemint-mark-light.svg`: 앱 라이트 테마용 정적 마크
- `public/brand/applemint-mark-dark.svg`: 앱 다크 테마용 정적 마크
- `public/brand/applemint-mark.png`: 문서와 비 SVG 환경을 위한 투명 PNG
- `public/applemint-logo.svg`: 독립형 워드마크 SVG
- `components/brand-logo.tsx`: 헤더와 로그인 화면의 반응형 로고
- `public/icons/icon-192.png`: PWA 및 알림 아이콘
- `public/icons/icon-512.png`: 고해상도 PWA 아이콘
- `public/icons/icon-maskable-512.png`: Android maskable 아이콘
- `public/icons/apple-touch-icon.png`: Apple Touch 아이콘
- `public/icons/notification-badge-96.png`: 푸시 알림 단색 배지
