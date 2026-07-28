import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { getWebPushServerConfiguration } from "./configuration";

const publicBytes = Buffer.alloc(65, 7);
publicBytes[0] = 4;
const validEnvironment = {
	WEB_PUSH_ENABLED: "true",
	VAPID_PUBLIC_KEY: publicBytes.toString("base64url"),
	VAPID_PRIVATE_KEY: Buffer.alloc(32, 9).toString("base64url"),
	VAPID_SUBJECT: "mailto:owner@applemint.test",
};

describe("Web Push server configuration", () => {
	it("feature flag 기본값은 비활성화이며 key를 공개하지 않는다", () => {
		expect(getWebPushServerConfiguration({})).toEqual({
			enabled: false,
			public: { enabled: false, publicKey: null, reason: "disabled" },
		});
	});

	it("flag와 유효한 VAPID 설정이 모두 있어야 활성화한다", () => {
		expect(getWebPushServerConfiguration(validEnvironment)).toMatchObject({
			enabled: true,
			public: {
				enabled: true,
				publicKey: validEnvironment.VAPID_PUBLIC_KEY,
				reason: null,
			},
			privateKey: validEnvironment.VAPID_PRIVATE_KEY,
			subject: validEnvironment.VAPID_SUBJECT,
		});
	});

	it.each([
		{ ...validEnvironment, VAPID_PUBLIC_KEY: "" },
		{ ...validEnvironment, VAPID_PRIVATE_KEY: "invalid" },
		{ ...validEnvironment, VAPID_SUBJECT: "http://not-secure.test" },
	])("누락되거나 잘못된 VAPID 설정을 fail closed한다", (environment) => {
		expect(getWebPushServerConfiguration(environment)).toEqual({
			enabled: false,
			public: { enabled: false, publicKey: null, reason: "configuration-missing" },
		});
	});
});
