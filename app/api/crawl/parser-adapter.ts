import type { CrawlFailure, CrawlWarning } from "./contracts";
import type { ParserOutcome } from "./parser-contracts";

export function adaptParserOutcome(url: string, outcome: ParserOutcome) {
	const warnings: CrawlWarning[] = outcome.warnings.map((warning) => ({
		url,
		...warning,
	}));

	if (outcome.status === "failure") {
		return {
			items: [],
			succeeded: false,
			warnings,
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
	};
}
