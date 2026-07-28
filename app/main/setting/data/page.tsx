"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Layers3, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { invalidateThreadQueries } from "@/lib/thread-query-cache";
import { bulkTrashInboxOptions, threadStatsOptions } from "@/lib/thread-query-options";
import { cn } from "@/lib/utils";
import { useTRPCClient } from "@/trpc/client";
import {
	SettingsFeedback,
	SettingsPageHeader,
	SettingsStatusItem,
	SettingsStatusStrip,
	SettingsSurface,
} from "../admin-ui";

export interface NewThreadStats {
	totalCount: number;
	counts: Array<{ key: string; label: string; count: number }>;
}

export function DataSummaryStrip({ stats }: { stats: NewThreadStats }) {
	return (
		<SettingsStatusStrip className="md:grid-cols-2 xl:grid-cols-4">
			<SettingsStatusItem
				icon={<Database aria-hidden="true" className="size-5" />}
				label="전체 신규 글"
				value={`${stats.totalCount.toLocaleString("ko-KR")}개`}
				valueTestId="new-thread-total-count"
				supporting="현재 받은 편지함 기준"
				tone={stats.totalCount > 0 ? "warning" : "success"}
			/>
			{stats.counts.slice(0, 3).map((count) => (
				<SettingsStatusItem
					key={count.key}
					icon={<Layers3 aria-hidden="true" className="size-5" />}
					label={count.label}
					value={`${count.count.toLocaleString("ko-KR")}개`}
					supporting="수집 유형별 신규 글"
				/>
			))}
		</SettingsStatusStrip>
	);
}

export function isBulkMoveDisabled(stats: NewThreadStats | undefined, isPending: boolean) {
	return isPending || !stats || stats.totalCount === 0;
}

export default function DataSettingPage() {
	const trpc = useTRPCClient();
	const queryClient = useQueryClient();
	const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
	const stats = useQuery(threadStatsOptions(trpc, "inbox"));
	const bulkMove = useMutation({
		...bulkTrashInboxOptions(trpc),
		onSuccess: async (movedCount) => {
			setResult({ success: true, message: `${movedCount}개의 신규 글을 휴지통으로 이동했습니다.` });
			await invalidateThreadQueries(queryClient, ["inbox", "trash"]);
		},
		onError: (error) => {
			setResult({
				success: false,
				message: error instanceof Error ? error.message : "신규 글을 이동하지 못했습니다.",
			});
		},
	});

	const handleBulkMove = async () => {
		setResult(null);
		await bulkMove.mutateAsync().catch(() => undefined);
	};

	return (
		<section aria-labelledby="data-settings-heading">
			<SettingsPageHeader
				title="데이터 관리"
				description="수집된 신규 글의 규모를 유형별로 확인하고 일괄 정리합니다."
				action={
					<Button variant="outline" onClick={() => stats.refetch()} disabled={stats.isFetching}>
						<RefreshCw
							aria-hidden="true"
							className={cn("mr-2 size-4", stats.isFetching && "animate-spin")}
						/>
						{stats.isFetching ? "확인 중..." : "새로고침"}
					</Button>
				}
			/>
			<h2 className="sr-only" id="data-settings-heading">
				데이터 관리
			</h2>

			{stats.isPending ? (
				<SettingsFeedback>데이터 현황을 불러오는 중입니다...</SettingsFeedback>
			) : null}
			{stats.isError ? (
				<Alert className="mt-6" variant="destructive">
					<AlertTitle>데이터 현황을 불러오지 못했습니다.</AlertTitle>
					<AlertDescription>{stats.error.message}</AlertDescription>
				</Alert>
			) : null}

			{stats.data ? <DataSummaryStrip stats={stats.data} /> : null}

			<SettingsSurface
				className="mt-6 border-red-200 bg-red-50/30 shadow-none dark:border-red-950 dark:bg-red-950/15"
				title="Danger zone"
				description="이 영역의 작업은 여러 데이터를 한 번에 변경합니다."
				contentClassName="px-4 py-5 sm:px-5"
			>
				<div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex min-w-0 items-start gap-3">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
							<Trash2 aria-hidden="true" className="size-5" />
						</div>
						<div>
							<h3 className="font-semibold text-base">신규 글 일괄 이동</h3>
							<p className="mt-1 text-muted-foreground text-sm leading-6">
								현재 신규 글 전체를 하나의 작업으로 휴지통에 이동합니다.
							</p>
							{stats.data ? (
								<div className="mt-2 font-medium text-red-700 text-sm dark:text-red-300">
									대상 {stats.data.totalCount.toLocaleString("ko-KR")}개
								</div>
							) : null}
						</div>
					</div>

					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								className="shrink-0"
								variant="destructive"
								disabled={isBulkMoveDisabled(stats.data, bulkMove.isPending)}
							>
								{bulkMove.isPending ? "이동 중..." : "모두 휴지통으로 이동"}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>신규 글 전체 이동</AlertDialogTitle>
								<AlertDialogDescription>
									신규 글 {stats.data?.totalCount.toLocaleString("ko-KR") ?? 0}개를 휴지통으로
									이동합니다. 계속하시겠습니까?
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel disabled={bulkMove.isPending}>취소</AlertDialogCancel>
								<AlertDialogAction disabled={bulkMove.isPending} onClick={handleBulkMove}>
									이동 진행
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>

				{result ? (
					<Alert className="mt-5" variant={result.success ? "default" : "destructive"}>
						<AlertTitle>{result.success ? "이동 완료" : "이동 실패"}</AlertTitle>
						<AlertDescription aria-live="polite">{result.message}</AlertDescription>
					</Alert>
				) : null}
			</SettingsSurface>
		</section>
	);
}
