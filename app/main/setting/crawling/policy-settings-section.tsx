import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CrawlPolicySettings, CrawlSourcePolicy } from "@/lib/crawl-policy-contract";
import { SettingsSurface } from "../admin-ui";
import type { ManualCrawlResult } from "./use-crawling-settings";

export function PolicySettingsSection({
	settings,
	status,
	manualResult,
	renderPolicy,
}: {
	settings: CrawlPolicySettings;
	status: ReactNode;
	manualResult: ManualCrawlResult | null;
	renderPolicy: (policy: CrawlSourcePolicy) => ReactNode;
}) {
	return (
		<>
			{status}
			{manualResult ? (
				<Alert className="mt-5" variant={manualResult.success ? "default" : "destructive"}>
					<AlertTitle>
						{settings.sources.find((policy) => policy.source === manualResult.source)?.label ??
							manualResult.source}{" "}
						{manualResult.success ? "완료" : "실패"}
					</AlertTitle>
					<AlertDescription>{manualResult.message}</AlertDescription>
				</Alert>
			) : null}

			<SettingsSurface className="mt-6" contentClassName="divide-y">
				<div className="hidden bg-muted/35 px-5 py-3 font-medium text-muted-foreground text-xs xl:grid xl:grid-cols-[1.15fr_0.8fr_1.05fr_1.25fr_1fr_8.5rem] xl:gap-4">
					<span>수집 소스</span>
					<span>예약 수집</span>
					<span>최소 수집 간격</span>
					<span>다음 예상 실행</span>
					<span>마지막 결과</span>
					<span className="text-center">작업</span>
				</div>
				<ul className="divide-y">{settings.sources.map(renderPolicy)}</ul>
			</SettingsSurface>

			<SettingsSurface className="mt-5 shadow-none" title="운영 안내" contentClassName="px-5 py-4">
				<ul className="space-y-2 text-muted-foreground text-sm leading-6">
					<li>최소 수집 간격은 각 소스의 과부하와 중복 실행을 방지합니다.</li>
					<li>수동 수집도 실행 중인 작업의 잠금과 최대 동시성 제한을 따릅니다.</li>
					<li>정책 변경은 소스별로 저장되며 다른 행의 편집 상태에 영향을 주지 않습니다.</li>
				</ul>
			</SettingsSurface>
		</>
	);
}
