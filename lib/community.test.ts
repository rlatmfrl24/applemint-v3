import { describe, expect, it } from "vitest";
import { getIssueLinkCommunityHost, getNormalSiteKey, getSiteDisplayLabel } from "./community";

describe("community labels", () => {
	it("알려진 host를 대표 커뮤니티 이름으로 표시한다", () => {
		expect(getSiteDisplayLabel("https://www.fmkorea.com/")).toBe("에펨코리아");
		expect(getSiteDisplayLabel("https://theqoo.net")).toBe("더쿠");
		expect(getSiteDisplayLabel("v12.battlepage.com")).toBe("배틀페이지");
	});

	it("알려진 사이트의 protocol, www, mobile host를 하나의 site key로 정규화한다", () => {
		expect(getNormalSiteKey("www.fmkorea.com")).toBe("fmkorea.com");
		expect(getNormalSiteKey("https://www.fmkorea.com/")).toBe("fmkorea.com");
		expect(getNormalSiteKey("m.fmkorea.com")).toBe("fmkorea.com");
		expect(getNormalSiteKey("https://v12.battlepage.com")).toBe("battlepage.com");
	});

	it("미등록 사이트는 정규화된 hostname으로 fallback한다", () => {
		expect(getSiteDisplayLabel("https://www.example.com/")).toBe("example.com");
	});

	it("IssueLink source key와 원 커뮤니티 host를 같은 정의에서 조회한다", () => {
		expect(getIssueLinkCommunityHost("fmkorea")).toBe("https://www.fmkorea.com");
		expect(getIssueLinkCommunityHost("unknown")).toBeNull();
	});
});
