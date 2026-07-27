"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { invalidateThreadQueries } from "@/lib/thread-query-cache";
import { bulkTrashInboxOptions, threadStatsOptions } from "@/lib/thread-query-options";
import { useTRPCClient } from "@/trpc/client";

interface NewThreadStats {
	totalCount: number;
	counts: Array<{ key: string; label: string; count: number }>;
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
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id="data-settings-heading">데이터 관리</h2>
					<p className="mt-2 text-muted-foreground text-sm">
						수집된 신규 글의 규모를 확인하고 일괄 정리합니다.
					</p>
				</div>
				<Button variant="outline" onClick={() => stats.refetch()} disabled={stats.isFetching}>
					{stats.isFetching ? "확인 중..." : "새로고침"}
				</Button>
			</div>

			{stats.isPending ? (
				<p className="mt-5 text-muted-foreground">데이터 현황을 불러오는 중입니다...</p>
			) : null}
			{stats.isError ? (
				<Alert className="mt-5" variant="destructive">
					<AlertTitle>데이터 현황을 불러오지 못했습니다.</AlertTitle>
					<AlertDescription>{stats.error.message}</AlertDescription>
				</Alert>
			) : null}

			{stats.data ? (
				<div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<p className="text-muted-foreground text-sm">전체 신규 글</p>
						</CardHeader>
						<CardContent>
							<p className="font-semibold text-3xl" data-testid="new-thread-total-count">
								{stats.data.totalCount.toLocaleString("ko-KR")}
							</p>
						</CardContent>
					</Card>
					{stats.data.counts.slice(0, 3).map((count: NewThreadStats["counts"][number]) => (
						<Card key={count.key}>
							<CardHeader className="pb-2">
								<p className="text-muted-foreground text-sm">{count.label}</p>
							</CardHeader>
							<CardContent>
								<p className="font-semibold text-3xl">{count.count.toLocaleString("ko-KR")}</p>
							</CardContent>
						</Card>
					))}
				</div>
			) : null}

			<Card className="mt-6 border-red-500/30">
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="rounded-full bg-red-500/10 p-2 text-red-600">
							<Trash2 aria-hidden="true" className="size-5" />
						</div>
						<div>
							<h3 className="text-xl">신규 글 일괄 이동</h3>
							<p className="mt-1 text-muted-foreground text-sm">
								현재 신규 글 전체를 원자적으로 휴지통으로 이동합니다.
							</p>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								variant="destructive"
								disabled={bulkMove.isPending || !stats.data || stats.data.totalCount === 0}
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
					{result ? (
						<Alert className="mt-4" variant={result.success ? "default" : "destructive"}>
							<AlertTitle>{result.success ? "이동 완료" : "이동 실패"}</AlertTitle>
							<AlertDescription aria-live="polite">{result.message}</AlertDescription>
						</Alert>
					) : null}
				</CardContent>
			</Card>
		</section>
	);
}
