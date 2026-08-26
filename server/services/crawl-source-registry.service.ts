import { CRAWL_SOURCES, type CrawlSource } from "@/contracts/crawl-source.schema";
import { unexpectedFailure } from "@/server/errors/domain-error";
import type { CrawlSourceRegistryStore } from "@/server/ports/crawl-source-registry.store";

export interface InstalledCrawlSource {
	source: CrawlSource;
	label: string;
}

function sameSources(left: readonly string[], right: readonly string[]) {
	return left.length === right.length && left.every((source, index) => source === right[index]);
}

export function attachInstalledCrawlSourceLabels<T extends { source: CrawlSource }>(
	rows: readonly T[],
	installedSources: readonly InstalledCrawlSource[],
	contractName: string
) {
	const rowSources = rows.map((row) => row.source).sort();
	const catalogSources = installedSources.map((entry) => entry.source).sort();
	if (!sameSources(rowSources, catalogSources)) {
		throw unexpectedFailure(`${contractName} source 목록이 활성 registry와 일치하지 않습니다.`, {
			rowSources,
			catalogSources,
		});
	}

	const labels = new Map(installedSources.map((entry) => [entry.source, entry.label]));
	return rows.map((row) => ({
		...row,
		label: labels.get(row.source) as string,
	}));
}

export class CrawlSourceRegistryService {
	constructor(private readonly store: CrawlSourceRegistryStore) {}

	async getInstalledSources(): Promise<InstalledCrawlSource[]> {
		const registry = await this.store.get();
		const activeSources = registry.sources
			.filter((entry) => entry.active)
			.map((entry) => entry.source)
			.sort();
		const installedSources = [...CRAWL_SOURCES].sort();

		if (!sameSources(activeSources, installedSources)) {
			throw unexpectedFailure("활성 수집 source registry가 설치된 adapter와 일치하지 않습니다.", {
				activeSources,
				installedSources,
			});
		}

		const activeLabels = new Map(
			registry.sources.filter((entry) => entry.active).map((entry) => [entry.source, entry.label])
		);
		return CRAWL_SOURCES.map((source) => {
			const label = activeLabels.get(source);
			if (!label) {
				throw unexpectedFailure(`활성 수집 source label이 없습니다: ${source}`);
			}
			return { source, label };
		});
	}
}
