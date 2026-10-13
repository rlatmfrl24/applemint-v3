import { DomainError } from "@/server/errors/domain-error";

export function normalizeBookmarkUrl(value: string) {
	try {
		const url = new URL(value.trim());
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
			throw new Error("unsafe URL");
		return url.toString();
	} catch {
		throw new DomainError("InvalidInput", "로그인 정보가 없는 HTTP 또는 HTTPS URL을 입력해주세요.");
	}
}
