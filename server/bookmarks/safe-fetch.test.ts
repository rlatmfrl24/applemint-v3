import { describe, expect, it } from "vitest";
import { isPublicAddress, safeFetch } from "./safe-fetch";

describe("bookmark outbound boundary", () => {
	it.each([
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.2.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"224.0.0.1",
		"::1",
		"::ffff:127.0.0.1",
		"fd00::1",
		"fe80::1",
		"2001:db8::1",
		"64:ff9b::a00:1",
	])("blocks internal/reserved %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
	it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
		"allows public %s",
		(ip) => expect(isPublicAddress(ip)).toBe(true)
	);
	it("blocks a loopback URL before opening a socket", async () => {
		await expect(safeFetch("http://127.0.0.1:54321")).rejects.toMatchObject({ code: "UNSAFE_URL" });
	});
	it("rejects a credential URL", async () => {
		await expect(safeFetch("https://user:pass@example.com")).rejects.toMatchObject({
			code: "UNSAFE_URL",
		});
	});
});
