"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTRPCClient } from "@/trpc/client";

const ModelChart = dynamic(() => import("./bookmark-model-chart"), {
	ssr: false,
	loading: () => (
		<div
			role="status"
			className="min-h-72 animate-pulse rounded-md bg-muted/30 motion-reduce:animate-none"
			aria-label="모델 차트를 불러오는 중"
		/>
	),
});

export function BookmarkAIUsagePanel() {
	const trpc = useTRPCClient();
	const [expanded, setExpanded] = useState(false);
	const query = useQuery({
		queryKey: ["bookmarks", "ai-usage"],
		queryFn: () => trpc.bookmarkAI.usage.query(),
		refetchInterval: 5000,
	});
	const usage = query.data;
	if (!usage)
		return (
			<div className="p-5">
				{query.error ? (
					<div role="alert" className="space-y-3 text-sm">
						<p>{query.error.message}</p>
						<Button size="sm" variant="outline" onClick={() => query.refetch()}>
							사용량 다시 확인
						</Button>
					</div>
				) : (
					<p role="status" aria-busy="true" className="min-h-24 text-muted-foreground text-sm">
						사용량을 불러오는 중…
					</p>
				)}
			</div>
		);
	const percent = (usage.usedNano / usage.limitNano) * 100;
	return (
		<div className="space-y-5 p-4 sm:p-5">
			<div className="space-y-2">
				<div className="flex items-baseline justify-between gap-2">
					<span className="text-muted-foreground text-xs">
						{usage.month.slice(0, 7)} · 한국 시간
					</span>
					<span className="text-xs tabular-nums">월 예산 $1</span>
				</div>
				<div
					className="h-1.5 overflow-hidden rounded-full bg-muted"
					role="progressbar"
					aria-label="월 AI 예산 사용률"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.min(100, percent)}
					aria-valuetext={`정산·예약 합계 $${(usage.usedNano / 1e9).toFixed(6)} / $1`}
				>
					<div
						className="h-full rounded-full bg-primary"
						style={{ width: `${Math.min(100, percent)}%` }}
					/>
				</div>
				<p className="text-muted-foreground text-xs">
					사용·예약 합계{" "}
					<span className="font-medium text-foreground tabular-nums">
						${(usage.usedNano / 1e9).toFixed(6)} / $1
					</span>
				</p>
			</div>
			<dl className="grid grid-cols-3 gap-3 border-b pb-4 text-xs">
				<div>
					<dt className="text-muted-foreground">요청</dt>
					<dd
						data-testid="bookmark-ai-requests"
						className="mt-1.5 font-medium text-sm tabular-nums"
					>
						{usage.requestCount}회
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">정산 비용</dt>
					<dd data-testid="bookmark-ai-charged" className="mt-1.5 font-medium text-sm tabular-nums">
						${(usage.chargedNano / 1e9).toFixed(6)}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">예약·확인 대기</dt>
					<dd data-testid="bookmark-ai-held" className="mt-1.5 font-medium text-sm tabular-nums">
						${(usage.heldNano / 1e9).toFixed(6)}
					</dd>
				</div>
			</dl>
			<details className="group" onToggle={(event) => setExpanded(event.currentTarget.open)}>
				<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md text-sm focus-visible:outline focus-visible:outline-ring">
					상세 사용량
					<ChevronDown
						aria-hidden="true"
						className="size-4 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
					/>
				</summary>
				{expanded &&
					(usage.requestCount > 0 ? (
						<ModelChart usage={usage} />
					) : (
						<p className="py-6 text-center text-muted-foreground text-sm">
							이번 달 AI 요청이 없습니다. 추천이나 분류를 사용하면 모델별 사용량이 표시됩니다.
						</p>
					))}
			</details>
			<p className="text-muted-foreground text-xs leading-5">
				정산·예약 장부 기준이며 해제된 요청은 제외합니다. 모델 정보가 없는 이전 요청은 ‘모델
				미기록’으로 표시합니다.
			</p>
			{query.error && (
				<p role="alert" className="text-destructive text-xs">
					최신 사용량 조회에 실패했습니다. 마지막 확인 값을 표시합니다.
				</p>
			)}
		</div>
	);
}
