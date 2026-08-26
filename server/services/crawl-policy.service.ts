import type { CrawlPolicyUpdateInput } from "@/contracts/crawl-policy.schema";
import { DomainError } from "@/server/errors/domain-error";
import type { CrawlPolicyStore } from "@/server/ports/crawl-policy.store";

export class CrawlPolicyService {
	constructor(private readonly store: CrawlPolicyStore) {}

	get() {
		return this.store.get();
	}

	async update(input: CrawlPolicyUpdateInput) {
		const result = await this.store.update(input);
		if (!result.updated) {
			throw new DomainError(
				"StateConflict",
				"다른 화면에서 정책이 변경되었습니다. 최신 값을 확인해주세요.",
				{ latestSettings: result.settings }
			);
		}
		return result.settings;
	}
}
