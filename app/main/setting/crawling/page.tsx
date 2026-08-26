"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock3,
	Globe2,
	PauseCircle,
	PlayCircle,
	RefreshCw,
	RotateCcw,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CrawlPolicySettings, CrawlSourcePolicy } from "@/lib/crawl-policy-contract";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import {
	SettingsFeedback,
	SettingsPageHeader,
	SettingsStatusItem,
	SettingsStatusStrip,
} from "../admin-ui";
import { PolicySettingsSection } from "./policy-settings-section";
import { useCrawlingSettings } from "./use-crawling-settings";

const ManualCrawlDialog = dynamic(
	() => import("./manual-crawl-dialog").then((module) => module.ManualCrawlDialog),
	{ ssr: false }
);

export const INTERVAL_PRESETS = [1, 2, 3, 4, 6, 12, 24].map((hours) => ({
	label: `${hours}시간`,
	seconds: hours * 3600,
}));

function formatDate(value: string | null) {
	if (!value) return "기록 없음";
	return new Intl.DateTimeFormat("ko-KR", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function formatInterval(seconds: number) {
	if (seconds % 3600 === 0) return `${seconds / 3600}시간`;
	return `${Math.round(seconds / 60)}분`;
}

function formatRelative(value: string, nowMs: number) {
	const differenceMinutes = Math.ceil((new Date(value).getTime() - nowMs) / 60_000);
	if (differenceMinutes <= 0) return "실행 대기 중";
	if (differenceMinutes < 60) return `${differenceMinutes}분 후`;
	const hours = Math.floor(differenceMinutes / 60);
	const minutes = differenceMinutes % 60;
	return minutes === 0 ? `${hours}시간 후` : `${hours}시간 ${minutes}분 후`;
}

export function nextPolicyBoundary(nowMs: number, intervalSeconds: number) {
	const intervalMs = intervalSeconds * 1000;
	return Math.ceil(nowMs / intervalMs) * intervalMs;
}

export function getIntervalMode(seconds: number) {
	return INTERVAL_PRESETS.some((preset) => preset.seconds === seconds) ? "preset" : "custom";
}

export function hasPolicyChanges(
	policy: CrawlSourcePolicy,
	scheduleEnabled: boolean,
	cooldownSeconds: number
) {
	return scheduleEnabled !== policy.scheduleEnabled || cooldownSeconds !== policy.cooldownSeconds;
}

export function willPolicyBecomeDue(
	policy: CrawlSourcePolicy,
	scheduleEnabled: boolean,
	cooldownSeconds: number,
	nowMs: number
) {
	return (
		scheduleEnabled &&
		policy.lastFinishedAt !== null &&
		new Date(policy.lastFinishedAt).getTime() + cooldownSeconds * 1000 <= nowMs &&
		(cooldownSeconds !== policy.cooldownSeconds || !policy.scheduleEnabled)
	);
}

function latestStatusLabel(policy: CrawlSourcePolicy) {
	if (!policy.latest) return "실행 기록 없음";
	const status = {
		running: "실행 중",
		succeeded: "성공",
		partial: "부분 성공",
		failed: "실패",
		interrupted: "중단됨",
	}[policy.latest.status];
	return `${policy.latest.trigger === "scheduled" ? "예약" : "수동"} ${status}`;
}

export function getNextScheduleText(
	policy: CrawlSourcePolicy,
	schedulerEnabled: boolean,
	scheduleEnabled: boolean,
	nowMs: number
) {
	if (!schedulerEnabled) return "전체 예약 시스템이 중지되어 있습니다.";
	if (!scheduleEnabled) return "이 소스의 예약 수집이 중지되어 있습니다.";
	if (policy.activeRunId) return "현재 실행 종료 후 다음 시각을 계산합니다.";
	return policy.nextScheduledAt
		? `${formatDate(policy.nextScheduledAt)} · ${formatRelative(policy.nextScheduledAt, nowMs)}`
		: "다음 실행 시각을 계산하고 있습니다.";
}

function LatestStatus({ policy }: { policy: CrawlSourcePolicy }) {
	if (!policy.latest) {
		return (
			<div>
				<div className="font-medium text-sm">실행 기록 없음</div>
				<div className="mt-1 text-muted-foreground text-xs">첫 실행 후 결과가 표시됩니다.</div>
			</div>
		);
	}

	const failed = policy.latest.status === "failed" || policy.latest.status === "interrupted";
	const warning = policy.latest.status === "partial" || policy.latest.status === "running";
	const Icon = failed ? AlertTriangle : warning ? Clock3 : CheckCircle2;

	return (
		<div>
			<div
				className={cn(
					"flex items-center gap-1.5 font-medium text-sm",
					failed && "text-red-600 dark:text-red-400",
					warning && "text-amber-700 dark:text-amber-400",
					!failed && !warning && "text-emerald-700 dark:text-emerald-400"
				)}
			>
				<Icon aria-hidden="true" className="size-4" />
				{latestStatusLabel(policy)}
			</div>
			<div className="mt-1 text-muted-foreground text-xs leading-5">
				{formatDate(policy.latest.finishedAt ?? policy.latest.startedAt)}
				<br />
				저장 {policy.latest.insertedCount}건 · 재시도 {policy.latest.retryCount}건
			</div>
		</div>
	);
}

function ScheduleSwitch({
	label,
	checked,
	onCheckedChange,
}: {
	label: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<label className="inline-flex cursor-pointer items-center gap-2.5">
			<span className="relative inline-flex h-6 w-11 shrink-0 items-center">
				<input
					aria-checked={checked}
					aria-label={`${label} 예약 수집`}
					checked={checked}
					className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
					onChange={(event) => onCheckedChange(event.target.checked)}
					role="switch"
					type="checkbox"
				/>
				<span className="pointer-events-none absolute inset-0 rounded-full bg-zinc-200 transition-colors peer-checked:bg-zinc-900 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 dark:bg-zinc-700 dark:peer-checked:bg-zinc-100" />
				<span className="pointer-events-none relative ml-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 dark:bg-zinc-950" />
			</span>
			<span className="text-sm">{checked ? "사용 중" : "중지됨"}</span>
		</label>
	);
}

function PolicyRow({
	policy,
	schedulerEnabled,
	nowMs,
	onManualCrawl,
	manualCrawlRunning,
}: {
	policy: CrawlSourcePolicy;
	schedulerEnabled: boolean;
	nowMs: number;
	onManualCrawl: (source: CrawlSourcePolicy["source"]) => Promise<void>;
	manualCrawlRunning: boolean;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [scheduleEnabled, setScheduleEnabled] = useState(policy.scheduleEnabled);
	const [cooldownSeconds, setCooldownSeconds] = useState(policy.cooldownSeconds);
	const [intervalMode, setIntervalMode] = useState<"preset" | "custom">(() =>
		getIntervalMode(policy.cooldownSeconds)
	);
	const [confirmingManualCrawl, setConfirmingManualCrawl] = useState(false);
	const updatePolicy = useMutation({
		...trpc.crawlPolicy.update.mutationOptions(),
		onSuccess: (settings) => {
			queryClient.setQueryData(trpc.crawlPolicy.get.queryKey(), settings);
			toast.success(`${policy.label} 수집 정책을 저장했습니다.`);
		},
		onError: (error) => {
			if (error.data?.latestSettings) {
				queryClient.setQueryData(trpc.crawlPolicy.get.queryKey(), error.data.latestSettings);
			}
			toast.error(error.message);
		},
	});

	useEffect(() => {
		setScheduleEnabled(policy.scheduleEnabled);
		setCooldownSeconds(policy.cooldownSeconds);
		setIntervalMode(getIntervalMode(policy.cooldownSeconds));
	}, [policy]);

	const dirty = hasPolicyChanges(policy, scheduleEnabled, cooldownSeconds);
	const willBecomeDue = willPolicyBecomeDue(policy, scheduleEnabled, cooldownSeconds, nowMs);
	const nextSchedule = getNextScheduleText(policy, schedulerEnabled, scheduleEnabled, nowMs);
	const saving = updatePolicy.isPending;

	const handleSave = () => {
		updatePolicy.mutate({
			source: policy.source,
			scheduleEnabled,
			cooldownSeconds,
			expectedUpdatedAt: policy.updatedAt,
		});
	};

	const handleReset = () => {
		setCooldownSeconds(policy.recommendedCooldownSeconds);
		setIntervalMode(getIntervalMode(policy.recommendedCooldownSeconds));
	};

	return (
		<li className="px-4 py-5 sm:px-5" data-testid={`crawl-policy-${policy.source}`}>
			<div className="grid gap-5 md:grid-cols-2 md:items-start xl:grid-cols-[1.15fr_0.8fr_1.05fr_1.25fr_1fr_8.5rem] xl:gap-4">
				<div className="min-w-0">
					<div className="flex items-start gap-3">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/30">
							<Globe2 aria-hidden="true" className="size-5" />
						</div>
						<div className="min-w-0">
							<h3 className="truncate font-semibold text-base">{policy.label}</h3>
							<div className="mt-1 text-muted-foreground text-xs leading-5">
								권장 {formatInterval(policy.recommendedCooldownSeconds)}
								<br />
								실행 예산 {policy.runBudgetSeconds}초
							</div>
						</div>
					</div>
				</div>

				<div>
					<div className="mb-2 font-medium text-muted-foreground text-xs xl:hidden">예약 수집</div>
					<ScheduleSwitch
						label={policy.label}
						checked={scheduleEnabled}
						onCheckedChange={setScheduleEnabled}
					/>
				</div>

				<div>
					<label
						className="mb-2 block font-medium text-muted-foreground text-xs xl:hidden"
						htmlFor={`${policy.source}-interval`}
					>
						최소 수집 간격
					</label>
					<select
						aria-label={`${policy.label} 최소 수집 간격`}
						className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						id={`${policy.source}-interval`}
						value={intervalMode === "custom" ? "custom" : String(cooldownSeconds)}
						onChange={(event) => {
							if (event.target.value === "custom") {
								setIntervalMode("custom");
								return;
							}
							setIntervalMode("preset");
							setCooldownSeconds(Number(event.target.value));
						}}
					>
						{INTERVAL_PRESETS.map((preset) => (
							<option key={preset.seconds} value={preset.seconds}>
								{preset.label}
							</option>
						))}
						<option value="custom">사용자 지정</option>
					</select>
					{intervalMode === "custom" ? (
						<label className="mt-2 block text-muted-foreground text-xs">
							사용자 지정(분)
							<input
								className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								max={10080}
								min={30}
								step={30}
								type="number"
								value={Math.round(cooldownSeconds / 60)}
								onChange={(event) => {
									const minutes = Number(event.target.value);
									if (Number.isInteger(minutes)) setCooldownSeconds(minutes * 60);
								}}
							/>
						</label>
					) : null}
					<Button
						className="mt-1 h-auto px-0 py-1 text-xs"
						type="button"
						variant="link"
						disabled={saving || cooldownSeconds === policy.recommendedCooldownSeconds}
						onClick={handleReset}
					>
						<RotateCcw aria-hidden="true" className="mr-1 size-3" />
						권장값 복원
					</Button>
				</div>

				<div>
					<div className="mb-2 font-medium text-muted-foreground text-xs xl:hidden">
						다음 예상 실행
					</div>
					<div className="flex items-start gap-2 text-sm">
						<Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<span className="leading-5" data-testid="next-scheduled-at">
							{nextSchedule}
						</span>
					</div>
				</div>

				<div>
					<div className="mb-2 font-medium text-muted-foreground text-xs xl:hidden">
						마지막 결과
					</div>
					<LatestStatus policy={policy} />
				</div>

				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={!dirty || saving}
						onClick={handleSave}
					>
						{saving ? "저장 중..." : "변경 저장"}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={manualCrawlRunning}
						onClick={() => setConfirmingManualCrawl(true)}
					>
						<PlayCircle aria-hidden="true" className="mr-1.5 size-4" />
						{manualCrawlRunning ? "수집 중..." : "지금 수집"}
					</Button>
				</div>
			</div>

			{confirmingManualCrawl ? (
				<ManualCrawlDialog
					label={policy.label}
					onClose={() => setConfirmingManualCrawl(false)}
					onConfirm={() => onManualCrawl(policy.source)}
				/>
			) : null}

			{willBecomeDue ? (
				<Alert className="mt-4 border-amber-300 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
					<AlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>저장 후 바로 실행 대상이 됩니다.</AlertTitle>
					<AlertDescription>
						예약 시스템이 켜져 있으면 다음 정책 확인 시 실행될 수 있습니다.
					</AlertDescription>
				</Alert>
			) : null}
		</li>
	);
}

function QueryFeedback({
	isPending,
	error,
}: {
	isPending: boolean;
	error: { message: string } | null;
}) {
	if (isPending) {
		return <SettingsFeedback>수집 정책을 불러오는 중입니다...</SettingsFeedback>;
	}
	if (error) {
		return (
			<Alert className="mt-6" variant="destructive">
				<AlertTitle>수집 정책을 불러오지 못했습니다.</AlertTitle>
				<AlertDescription className="mt-2">{error.message}</AlertDescription>
			</Alert>
		);
	}
	return null;
}

function SchedulerStatus({ settings, nowMs }: { settings: CrawlPolicySettings; nowMs: number }) {
	const enabledCount = settings.sources.filter((source) => source.scheduleEnabled).length;
	const activeCount = settings.sources.filter((source) => source.activeRunId !== null).length;
	const intervalMinutes = Math.round(settings.dispatcherIntervalSeconds / 60);

	return (
		<SettingsStatusStrip>
			<SettingsStatusItem
				icon={
					settings.schedulerEnabled ? (
						<CheckCircle2 aria-hidden="true" className="size-5" />
					) : (
						<PauseCircle aria-hidden="true" className="size-5" />
					)
				}
				label="예약 시스템"
				value={settings.schedulerEnabled ? "동작 중" : "중지됨"}
				supporting={`DB가 ${intervalMinutes}분마다 실행 대상을 확인합니다.`}
				tone={settings.schedulerEnabled ? "success" : "warning"}
			/>
			<SettingsStatusItem
				icon={<Clock3 aria-hidden="true" className="size-5" />}
				label="다음 정책 확인"
				value={formatDate(
					new Date(nextPolicyBoundary(nowMs, settings.dispatcherIntervalSeconds)).toISOString()
				)}
				supporting={`확인 주기 ${intervalMinutes}분`}
			/>
			<SettingsStatusItem
				icon={<Activity aria-hidden="true" className="size-5" />}
				label="예약·실행 소스"
				value={`${enabledCount}개 예약 · ${activeCount}개 실행`}
				supporting={`전체 ${settings.sources.length}개 소스`}
				tone={activeCount > 0 ? "warning" : "neutral"}
			/>
		</SettingsStatusStrip>
	);
}

export default function CrawlingSettingPage() {
	const { query, nowMs, manualSource, manualResult, handleManualCrawl } = useCrawlingSettings();

	return (
		<section aria-labelledby="crawl-settings-heading">
			<SettingsPageHeader
				title="수집 설정"
				description="소스별 예약 주기와 실행 상태를 한 화면에서 비교하고 필요한 작업을 수행합니다."
				action={
					<Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
						<RefreshCw
							aria-hidden="true"
							className={cn("mr-2 size-4", query.isFetching && "animate-spin")}
						/>
						{query.isFetching ? "확인 중..." : "새로고침"}
					</Button>
				}
			/>

			<h2 className="sr-only" id="crawl-settings-heading">
				수집 설정
			</h2>
			<QueryFeedback isPending={query.isPending} error={query.isError ? query.error : null} />
			{query.data ? (
				<PolicySettingsSection
					settings={query.data}
					status={<SchedulerStatus settings={query.data} nowMs={nowMs} />}
					manualResult={manualResult}
					renderPolicy={(policy) => (
						<PolicyRow
							key={policy.source}
							policy={policy}
							schedulerEnabled={query.data.schedulerEnabled}
							nowMs={nowMs}
							onManualCrawl={handleManualCrawl}
							manualCrawlRunning={manualSource !== null}
						/>
					)}
				/>
			) : null}
		</section>
	);
}
