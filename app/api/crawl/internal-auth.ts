import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function hasValidInternalSecret(
	provided: string | null,
	expected: string | null | undefined
) {
	if (!provided || !expected) {
		return false;
	}

	return timingSafeEqual(digest(provided), digest(expected));
}

export function hasMinimumInternalSecretLength(
	secret: string | null | undefined
): secret is string {
	return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
}
