# Bklit pie chart

2026-10-14에 Bklit UI의 공식 shadcn registry에서 필요한 pie chart와 애니메이션 파일만 가져왔다.

- 원본: https://ui.bklit.com/r/pie-chart.json 및 https://ui.bklit.com/r/chart-animation.json
- 문서: https://bklit.com/docs/components/pie-chart
- 저장소: https://github.com/bklit/bklit-ui
- 라이선스: MIT, 원문은 이 디렉터리의 `LICENSE`에 보존했다. 상용 Studio 코드는 포함하지 않는다.

Applemint에서는 파일 위치·포맷을 맞추고 사용하지 않는 export와 cartesian reveal helper를 제거했다. 정적 slice 렌더의 공통 opacity/filter를 변수로 옮겼다. 차트 API와 SVG/hover 동작은 유지한다.

설정 페이지에서만 동적으로 로드한다. 진입 애니메이션과 glow를 끄며, 키보드로도 확인할 수 있는 모델별 수치 표를 함께 제공한다. 이 디렉터리의 소스는 일반 Biome·TypeScript·Knip 검사 대상이다.
