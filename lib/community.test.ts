import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	getIssueLinkCommunityHost,
	getNormalSiteKey,
	getSiteDisplayLabel,
	NORMAL_SITE_CATALOG,
} from "./community";

function readSharedNormalSiteFixture() {
	const fixturePath = fileURLToPath(
		new URL("../supabase/tests/fixtures/normal-site-catalog-values.inc", import.meta.url)
	);
	const fixture = readFileSync(fixturePath, "utf8");
	return Array.from(
		fixture.matchAll(/\('([^']+)',\s*'((?:''|[^'])*)',\s*'([^']+)'\)/gu),
		([, siteKey, label, host]) => ({ siteKey, label: label.replaceAll("''", "'"), host })
	);
}

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

	it("대표 site catalog가 SQL 정규화 테스트와 같은 fixture를 사용한다", () => {
		const sortBySiteKey = <T extends { siteKey: string }>(rows: readonly T[]) =>
			[...rows].sort((left, right) => left.siteKey.localeCompare(right.siteKey));
		expect(sortBySiteKey(NORMAL_SITE_CATALOG)).toEqual(
			sortBySiteKey(readSharedNormalSiteFixture())
		);
	});
});
