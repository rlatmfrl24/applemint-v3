import { describe, expect, it } from "vitest";
import { hasMinimumInternalSecretLength, hasValidInternalSecret } from "./internal-auth";

describe("hasValidInternalSecret", () => {
	const secret = "0123456789abcdef0123456789abcdef";

	it("동일한 secret만 허용한다", () => {
		expect(hasValidInternalSecret(secret, secret)).toBe(true);
		expect(hasValidInternalSecret(`${secret}x`, secret)).toBe(false);
	});

	it("누락된 secret을 거부한다", () => {
		expect(hasValidInternalSecret(null, secret)).toBe(false);
		expect(hasValidInternalSecret(secret, undefined)).toBe(false);
	});

	it("secret 최소 길이를 UTF-8 32바이트로 검사한다", () => {
		expect(hasMinimumInternalSecretLength("a".repeat(31))).toBe(false);
		expect(hasMinimumInternalSecretLength("a".repeat(32))).toBe(true);
		expect(hasMinimumInternalSecretLength("가".repeat(11))).toBe(true);
	});
});
