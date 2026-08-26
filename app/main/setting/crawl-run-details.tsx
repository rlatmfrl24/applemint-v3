import type { CrawlRun } from "@/lib/crawl-run-contract";

function getWarningSeverity(warning: CrawlRun["warnings"][number]) {
	if (warning.severity) return warning.severity;
	return warning.code === "below-minimum-items" || warning.code === "high-discard-rate"
		? "warning"
		: "info";
}

export function CrawlRunDetails({ run }: { run: CrawlRun }) {
	return (
		<div data-testid="crawl-run-details">
			{run.errorMessage ? (
				<p className="mt-3 text-red-600 dark:text-red-400">
					[{run.errorStage ?? "unknown"}] {run.errorMessage}
				</p>
			) : null}
			{run.failures.length > 0 ? (
				<div className="mt-3">
					<p className="font-medium">실패</p>
					<ul className="mt-1 list-disc space-y-1 pl-5">
						{run.failures.map((failure) => (
							<li
								key={`${failure.url ?? "failure"}-${failure.attempt ?? 0}-${failure.kind ?? "unknown"}-${failure.message ?? ""}`}
							>
								시도 {failure.attempt ?? 1} ·{" "}
								{failure.timeout ? "timeout" : (failure.kind ?? "unknown")} ·{" "}
								{failure.message ?? "상세 없음"}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{run.warnings.length > 0 ? (
				<div className="mt-3">
					<p className="font-medium">진단</p>
					<ul className="mt-1 list-disc space-y-1 pl-5">
						{run.warnings.map((warning) => (
							<li
								key={`${warning.url ?? "warning"}-${warning.attempt ?? 0}-${warning.code ?? "warning"}-${warning.message ?? ""}`}
							>
								시도 {warning.attempt ?? 1} · {getWarningSeverity(warning)} ·{" "}
								{warning.code ?? "warning"} · {warning.message ?? "상세 없음"}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{run.parserObservations.length > 0 ? (
				<div className="mt-3 overflow-x-auto">
					<table className="w-full min-w-2xl text-left text-xs">
						<thead>
							<tr className="border-b">
								<th className="p-2">시도</th>
								<th className="p-2">상태</th>
								<th className="p-2">후보</th>
								<th className="p-2">유효</th>
								<th className="p-2">제외</th>
								<th className="p-2">무시</th>
								<th className="p-2">중복</th>
								<th className="p-2">최소</th>
							</tr>
						</thead>
						<tbody>
							{run.parserObservations.map((observation) => (
								<tr
									className="border-b last:border-0"
									key={`${observation.url}-${observation.attempt ?? 0}`}
								>
									<td className="p-2">{observation.attempt ?? 1}</td>
									<td className="p-2">{observation.status}</td>
									<td className="p-2">{observation.candidateCount}</td>
									<td className="p-2">{observation.validCount}</td>
									<td className="p-2">{observation.discardedCount}</td>
									<td className="p-2">{observation.ignoredCount ?? 0}</td>
									<td className="p-2">{observation.duplicateCount ?? 0}</td>
									<td className="p-2">{observation.minimumItems}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</div>
	);
}
