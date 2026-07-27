import { describe, expect, it } from "vitest";
import { getThreadTypeLabel } from "./thread-type";

describe("getThreadTypeLabel", () => {
	it("공급자 타입만 명확한 표시 라벨로 변환한다", () => {
		expect(getThreadTypeLabel("youtube")).toBe("YouTube");
		expect(getThreadTypeLabel("imgur")).toBe("Imgur");
		expect(getThreadTypeLabel("normal")).toBe("normal");
	});
});
