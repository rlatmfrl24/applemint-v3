import type {
	CrawlPolicySettingsRaw,
	CrawlPolicyUpdateInput,
} from "@/contracts/crawl-policy.schema";
import { DomainError } from "@/server/errors/domain-error";
import type { CrawlPolicyStore } from "@/server/ports/crawl-policy.store";
import {
	attachInstalledCrawlSourceLabels,
	type CrawlSourceRegistryService,
} from "./crawl-source-registry.service";

export class CrawlPolicyService {
	constructor(
		private readonly store: CrawlPolicyStore,
		private readonly registry: CrawlSourceRegistryService
	) {}

	async get() {
		const [settings, installedSources] = await Promise.all([
			this.store.get(),
			this.registry.getInstalledSources(),
		]);
		return this.withLabels(settings, installedSources);
	}

	async update(input: CrawlPolicyUpdateInput) {
		// Validate adapter/registry parity before the compare-and-swap mutation so
		// a registry outage or drift cannot turn a committed update into an
		// ambiguous client-side failure.
		const installedSources = await this.registry.getInstalledSources();
		const result = await this.store.update(input);
		const settings = this.withLabels(result.settings, installedSources);
		if (!result.updated) {
			throw new DomainError(
				"StateConflict",
				"다른 화면에서 정책이 변경되었습니다. 최신 값을 확인해주세요.",
				{ latestSettings: settings }
			);
		}
		return settings;
	}

	private withLabels(
		settings: CrawlPolicySettingsRaw,
		installedSources: Awaited<ReturnType<CrawlSourceRegistryService["getInstalledSources"]>>
	) {
		return {
			...settings,
			sources: attachInstalledCrawlSourceLabels(settings.sources, installedSources, "수집 정책"),
		};
	}
}
