import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getAllowedRequestHeaders } from "./middleware";

describe("getAllowedRequestHeaders", () => {
	it("JSON POST body 처리에 필요한 헤더를 세션 갱신 이후에도 보존한다", () => {
		const request = new NextRequest("http://localhost/api/crawl/manual", {
			method: "POST",
			headers: {
				"Content-Length": "22",
				"Content-Type": "application/json",
				Cookie: "session=test",
				"x-untrusted-header": "discard-me",
			},
			body: JSON.stringify({ target: "arcalive" }),
		});

		const headers = getAllowedRequestHeaders(request);

		expect(headers.get("content-length")).toBe("22");
		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.get("cookie")).toBe("session=test");
		expect(headers.get("x-untrusted-header")).toBeNull();
	});
});
