import { describe, expect, it } from "vitest";
import { resolveCrawlExecutionMode } from "./execution-mode";

describe("resolveCrawlExecutionMode", () => {
	it("설정이 없으면 Next 직접 실행을 기본값으로 사용한다", () => {
		expect(resolveCrawlExecutionMode(undefined)).toBe("next");
		expect(resolveCrawlExecutionMode("  ")).toBe("next");
	});

	it("명시한 호환 실행 모드를 정규화한다", () => {
		expect(resolveCrawlExecutionMode("NEXT")).toBe("next");
		expect(resolveCrawlExecutionMode(" edge ")).toBe("edge");
	});

	it("잘못된 값은 임의 경로로 fallback하지 않는다", () => {
		expect(resolveCrawlExecutionMode("legacy")).toBeNull();
	});
});
