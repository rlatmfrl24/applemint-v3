import { describe, expect, it } from "vitest";
import { checkBookmarkLink } from "./health";

describe.skipIf(process.env.BOOKMARK_LIVE_NETWORK !== "1")("actual public link checks", () => {
	it("receives a real public 200 using the validated connection address", async () => {
		expect(await checkBookmarkLink("https://example.com")).toMatchObject({
			status: "healthy",
			httpStatus: 200,
		});
	});
	it("separates actual 404 and NXDOMAIN from connection failures", async () => {
		expect(await checkBookmarkLink("https://example.com/applemint-absent")).toMatchObject({
			status: "dead",
			httpStatus: 404,
		});
		expect(await checkBookmarkLink("https://applemint-missing.invalid")).toMatchObject({
			status: "dead",
			httpStatus: null,
		});
	});
});
