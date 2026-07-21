import type { CrawlFailure, CrawlWarning } from "./contracts";
import type { ParserOutcome } from "./parser-contracts";

export function adaptParserOutcome(url: string, outcome: ParserOutcome) {
	const warnings: CrawlWarning[] = outcome.warnings.map((warning) => ({
		url,
		...warning,
	}));
	const observation = {
		url,
		status: outcome.status,
		candidateCount: outcome.candidateCount,
		validCount: outcome.items.length,
		discardedCount: outcome.discardedCount,
		ignoredCount: outcome.ignoredCount,
		duplicateCount: outcome.duplicateCount,
		minimumItems: outcome.minimumItems,
	} as const;

	if (outcome.status === "failure") {
		return {
			items: [],
			succeeded: false,
			warnings,
			observation,
			failure: {
				url,
				kind: "parser",
				message: outcome.failure?.message ?? "Parser failure",
			} satisfies CrawlFailure,
		};
	}

	return {
		items: outcome.items,
		succeeded: true,
		warnings,
		observation,
	};
}
