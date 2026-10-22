"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { bookmarkFieldClass } from "@/components/bookmark-collection-picker";
import { Button } from "@/components/ui/button";
import type { BookmarkHealthSettings } from "@/contracts/bookmark.schema";
import { useTRPCClient } from "@/trpc/client";
import { SettingsSurface } from "../admin-ui";

function HealthForm({ settings }: { settings: BookmarkHealthSettings }) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const id = useId();
	const [enabled, setEnabled] = useState(settings.enabled);
	const [dailyLimit, setLimit] = useState(String(settings.dailyLimit));
	const update = useMutation({
		mutationFn: () =>
			trpc.bookmarkCheck.updateSettings.mutate({ enabled, dailyLimit: Number(dailyLimit) }),
		onSuccess: async (data) => {
			cache.setQueryData(["bookmarks", "health-settings"], data);
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("자동 검사 설정을 저장했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
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
				매일 자동 점검
			</label>
			<div className="flex flex-wrap items-center gap-2">
				<label htmlFor={`${id}limit`}>하루 점검 개수</label>
				<input
					id={`${id}limit`}
					className={`${bookmarkFieldClass} w-28`}
					type="number"
					min={1}
					max={1000}
					required
					value={dailyLimit}
					onChange={(event) => setLimit(event.target.value)}
					disabled={update.isPending}
				/>
				<span className="text-muted-foreground text-xs">1–1,000개 · 기본 500개</span>
			</div>
			<p className="text-muted-foreground text-xs">
				KST 매일 09:00 이후 순서대로 점검합니다. 끄면 다음 검사부터 중단하며 이미 시작한 검사의
				결과와 정산은 보존됩니다.
			</p>
			<p className="text-muted-foreground text-xs">
				자동 삭제 없이 검토 화면에서 상태와 근거를 보고 직접 정리합니다. AI는 기존 월 $1 예산을 함께
				사용합니다. 판단이 불명확하면 원문 발췌가 기존 AI 공급자로 전송될 수 있습니다.
			</p>
			{!settings.workerConfigured && (
				<p role="status" className="text-destructive text-xs">
					자동 실행 서버 설정이 필요합니다. 설정을 저장해도 worker가 연결되기 전에는 검사할 수
					없습니다.
				</p>
			)}
			{settings.enabled && !settings.lastAutomaticJob && (
				<p role="status" className="text-muted-foreground text-xs">
					아직 등록된 자동 검사가 없습니다. 09시 이후 다음 정상 실행 때 대상과 대기 작업을
					확인합니다.
				</p>
			)}
			{settings.lastAutomaticJob && (
				<p className="text-xs">
					최근 자동 검사 {String(settings.lastAutomaticJob.scope.automaticDate ?? "")} ·{" "}
					{settings.lastAutomaticJob.completed}/{settings.lastAutomaticJob.total}개 완료
					{settings.lastAutomaticJob.error && ` · ${settings.lastAutomaticJob.error}`}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-3">
				<Button size="sm" type="submit" disabled={update.isPending}>
					{update.isPending ? "저장 중…" : "자동 검사 설정 저장"}
				</Button>
				<Link className="text-xs underline" href="/main/bookmarks/activity">
					작업 기록과 대기 사유
				</Link>
			</div>
		</form>
	);
}
export function BookmarkHealthSettingsPanel() {
	const trpc = useTRPCClient();
	const query = useQuery({
		queryKey: ["bookmarks", "health-settings"],
		queryFn: () => trpc.bookmarkCheck.settings.query(),
		refetchInterval: 30000,
	});
	return (
		<SettingsSurface
			title="북마크 내용 점검"
			description="오래된 링크의 접속·본문·사진과 동영상 응답을 나누어 확인합니다."
			className="min-w-0 shadow-none"
		>
			{query.data ? (
				<HealthForm key={`${query.data.enabled}:${query.data.dailyLimit}`} settings={query.data} />
			) : query.error ? (
				<div className="p-5">
					<p role="alert">{query.error.message}</p>
					<Button variant="outline" size="sm" onClick={() => query.refetch()}>
						검사 설정 다시 불러오기
					</Button>
				</div>
			) : (
				<p role="status" className="p-5 text-muted-foreground text-sm">
					검사 설정을 불러오는 중…
				</p>
			)}
		</SettingsSurface>
	);
}
