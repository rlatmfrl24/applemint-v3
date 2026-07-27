import type { CrawlPolicyUpdateInput } from "@/contracts/crawl-policy.schema";
import { DomainError } from "@/server/errors/domain-error";
import type { CrawlPolicyRepository } from "@/server/repositories/crawl-policy.repository";

export class CrawlPolicyService {
	constructor(private readonly repository: CrawlPolicyRepository) {}

	get() {
		return this.repository.get();
	}

	async update(input: CrawlPolicyUpdateInput) {
		const result = await this.repository.update(input);
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
