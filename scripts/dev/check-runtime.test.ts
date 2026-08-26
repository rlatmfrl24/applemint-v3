import { describe, expect, it } from "vitest";
import { REQUIRED_NODE_MAJOR, validateNodeVersion } from "./check-runtime.mjs";

describe("Node runtime contract", () => {
	it("accepts Node 24 patch versions", () => {
		expect(validateNodeVersion("24.0.0")).toEqual({ ok: true });
		expect(validateNodeVersion("24.19.0")).toEqual({ ok: true });
		expect(REQUIRED_NODE_MAJOR).toBe(24);
	});

	it.each(["23.11.1", "25.2.1", "invalid"])("rejects unsupported runtime %s", (version) => {
		expect(validateNodeVersion(version)).toEqual({
			ok: false,
			message: expect.stringContaining(`현재 버전: ${version}`),
		});
	});
});
