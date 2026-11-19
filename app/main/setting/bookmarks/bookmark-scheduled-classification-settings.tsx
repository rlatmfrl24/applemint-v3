"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { bookmarkFieldClass } from "@/components/bookmark-collection-picker";
import { Button } from "@/components/ui/button";
import type { BookmarkScheduledSettings } from "@/contracts/bookmark-scheduled-classification.schema";
import { useTRPCClient } from "@/trpc/client";
import { SettingsSurface } from "../admin-ui";

const settingsKey = ["bookmarks", "scheduled-classification"] as const;
const statusLabel: Record<BookmarkScheduledSettings["status"], string> = {
	disabled: "꺼짐",
	waiting: "다음 회차 대기",
	running: "회차 진행 중",
	blocked: "회차 재개 또는 종료 필요",
	complete: "대상 확인 완료",
};

const koreanTime = new Intl.DateTimeFormat("ko-KR", {
	timeZone: "Asia/Seoul",
	dateStyle: "medium",
	timeStyle: "short",
	hourCycle: "h23",
});

function ScheduledForm({ settings }: { settings: BookmarkScheduledSettings }) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const id = useId();
	const [enabled, setEnabled] = useState(settings.enabled);
	const [limit, setLimit] = useState(String(settings.dailyLimit));
	const update = useMutation({
		mutationFn: () =>
			trpc.bookmarkAI.updateScheduledSettings.mutate({ enabled, dailyLimit: Number(limit) }),
		onSuccess: async (updated) => {
			cache.setQueryData(settingsKey, updated);
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("정기 재분류 설정을 저장했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
	const lastJob = settings.lastJob;
	return (
		<form
			className="space-y-3 p-5 text-sm"
			onSubmit={(event) => {
				event.preventDefault();
				update.mutate();
			}}
		>
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={enabled}
					disabled={update.isPending}
					onChange={(event) => setEnabled(event.target.checked)}
				/>
				매일 재분류
			</label>
			<div className="flex flex-wrap items-center gap-2">
				<label htmlFor={id}>회차당 북마크 수</label>
				<input
					id={id}
					className={`${bookmarkFieldClass} w-28`}
					type="number"
					min={1}
					max={500}
					required
					value={limit}
					disabled={update.isPending}
					onChange={(event) => setLimit(event.target.value)}
				/>
			</div>
			<p className="text-muted-foreground text-xs">
				매일 09:00 KST 이후 오래된 북마크부터 분류합니다. 기존 AI 기능과 월 $1 예산을 공유합니다.
			</p>
			<dl className="space-y-1 text-xs">
				<div className="flex flex-wrap gap-x-2">
					<dt className="text-muted-foreground">상태</dt>
					<dd role="status">{statusLabel[settings.status]}</dd>
				</div>
				{settings.startedAt && (
					<div className="flex flex-wrap gap-x-2">
						<dt className="text-muted-foreground">최초 활성화</dt>
						<dd>{koreanTime.format(new Date(settings.startedAt))} KST</dd>
					</div>
				)}
				{settings.nextEligibleAt && (
					<div className="flex flex-wrap gap-x-2">
						<dt className="text-muted-foreground">다음 실행 가능 시각</dt>
						<dd>{koreanTime.format(new Date(settings.nextEligibleAt))} KST</dd>
					</div>
				)}
			</dl>
			<div className="flex flex-wrap items-center gap-3">
				<Button size="sm" type="submit" disabled={update.isPending}>
					{update.isPending ? "저장 중…" : "정기 재분류 설정 저장"}
				</Button>
				<Link
					className="text-xs underline"
					href={
						lastJob
							? `/main/bookmarks/activity#bookmark-job-${lastJob.id}`
							: "/main/bookmarks/activity"
					}
				>
					{lastJob ? `최근 회차 ${String(lastJob.scope.scheduledDate)}` : "작업 기록"}
				</Link>
			</div>
		</form>
	);
}

export function BookmarkScheduledClassificationSettings() {
	const trpc = useTRPCClient();
	const settings = useQuery({
		queryKey: settingsKey,
		queryFn: () => trpc.bookmarkAI.scheduledSettings.query(),
		refetchInterval: 30000,
	});
	return (
		<SettingsSurface
			title="정기 재분류"
			description="기존 북마크를 분류해 이동을 제안합니다. 검토 화면에서 승인한 항목만 이동합니다."
			className="min-w-0 shadow-none"
		>
			{settings.data ? (
				<ScheduledForm
					key={`${settings.data.enabled}:${settings.data.dailyLimit}`}
					settings={settings.data}
				/>
			) : settings.error ? (
				<div className="space-y-2 p-5 text-sm">
					<p role="alert">{settings.error.message}</p>
					<Button size="sm" variant="outline" onClick={() => settings.refetch()}>
						정기 재분류 설정 다시 불러오기
					</Button>
				</div>
			) : (
				<p role="status" className="p-5 text-muted-foreground text-sm">
					정기 재분류 설정을 불러오는 중…
				</p>
			)}
		</SettingsSurface>
	);
}
