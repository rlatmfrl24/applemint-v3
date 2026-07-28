import { Buffer } from "node:buffer";
import { type PushConfiguration, pushConfigurationSchema } from "@/contracts/push.schema";

interface WebPushEnvironment {
	[key: string]: string | undefined;
	WEB_PUSH_ENABLED?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
}

export type WebPushServerConfiguration =
	| {
			enabled: false;
			public: PushConfiguration;
	  }
	| {
			enabled: true;
			public: PushConfiguration;
			publicKey: string;
			privateKey: string;
			subject: string;
	  };

function isBase64Url(value: string) {
	return /^[A-Za-z0-9_-]+$/.test(value);
}

function hasExpectedDecodedLength(value: string, expectedLength: number) {
	if (!isBase64Url(value)) return false;
	try {
		return Buffer.from(value, "base64url").byteLength === expectedLength;
	} catch {
		return false;
	}
}

function isValidSubject(value: string) {
	if (value.startsWith("mailto:")) {
		return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
	}
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

export function getWebPushServerConfiguration(
	environment: WebPushEnvironment = process.env
): WebPushServerConfiguration {
	if (environment.WEB_PUSH_ENABLED !== "true") {
		return {
			enabled: false,
			public: pushConfigurationSchema.parse({
				enabled: false,
				publicKey: null,
				reason: "disabled",
			}),
		};
	}

	const publicKey = environment.VAPID_PUBLIC_KEY?.trim() ?? "";
	const privateKey = environment.VAPID_PRIVATE_KEY?.trim() ?? "";
	const subject = environment.VAPID_SUBJECT?.trim() ?? "";
	const validPublicKey =
		hasExpectedDecodedLength(publicKey, 65) && Buffer.from(publicKey, "base64url")[0] === 4;

	if (!validPublicKey || !hasExpectedDecodedLength(privateKey, 32) || !isValidSubject(subject)) {
		return {
			enabled: false,
			public: pushConfigurationSchema.parse({
				enabled: false,
				publicKey: null,
				reason: "configuration-missing",
			}),
		};
	}

	return {
		enabled: true,
		public: pushConfigurationSchema.parse({
			enabled: true,
			publicKey,
			reason: null,
		}),
		publicKey,
		privateKey,
		subject,
	};
}
