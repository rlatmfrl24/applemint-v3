# 크롤러 parser fixtures

아래 fixture는 공개 응답에서 parser에 필요한 DOM/JSON 구조만 추출한 스냅샷입니다.
게시물 내용, 작성자, 시간, 광고, 동적 token은 테스트용 값으로 정제했습니다.

- `arcalive-current.html`: `https://arca.live/b/iloveanimal?mode=best&p=1`
- `battlepage-current.html`: `https://v12.battlepage.com/??=Board.Humor.Table&page=1`
- `battlepage-empty.html`: `https://v12.battlepage.com/??=Board.Humor.Table&page=9999`
- `insagirl-current.json`: `https://insagirl-hrm.appspot.com/json2/1/1/2/`
- `issuelink-current.html`: `https://www.issuelink.co.kr/community/listview/all/12/adj/_self/blank/blank/blank` (2026-08-26 확인)

CI에서는 fixture만 사용합니다. fixture를 갱신할 때는 실제 응답 구조와 source URL을 다시 확인합니다.
