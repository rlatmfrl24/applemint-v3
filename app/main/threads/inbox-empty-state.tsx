"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Inbox, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CrawlPolicySettings, CrawlSourcePolicy } from "@/lib/crawl-policy-contract";
import { CRAWL_SOURCE_LABELS } from "@/lib/crawl-source";
import { invalidateThreadQueries } from "@/lib/thread-query-cache";
import { useTRPC } from "@/trpc/client";

const ACTIVE_REFETCH_INTERVAL_MS = 5_000;
const IDLE_REFETCH_INTERVAL_MS = 60_000;
const DEADLINE_HANDOFF_GRACE_MS = 30_000;

export interface NextCrawlSchedule {
	scheduledAt: string;
	scheduledAtMs: number;
	sources: CrawlSourcePolicy["source"][];
}

interface DeadlineHandoff {
	scheduledAt: string;
	expiresAtLocalMs: number;
}

export type InboxSchedulePresentation =
	| { kind: "active"; sources: CrawlSourcePolicy["source"][] }
	| { kind: "countdown"; remainingMs: number; schedule: NextCrawlSchedule }
	| { kind: "stopped"; message: string }
	| { kind: "waiting"; message: string };

export function selectNextCrawlSchedule(settings: CrawlPolicySettings): NextCrawlSchedule | null {
	if (!settings.schedulerEnabled) return null;

	const candidates = settings.sources.flatMap((policy) => {
		if (!policy.scheduleEnabled || !policy.nextScheduledAt) return [];
		const scheduledAtMs = new Date(policy.nextScheduledAt).getTime();
		return Number.isFinite(scheduledAtMs)
			? [{ source: policy.source, scheduledAt: policy.nextScheduledAt, scheduledAtMs }]
			: [];
	});

	const nearestMs = candidates.reduce(
		(nearest, candidate) => Math.min(nearest, candidate.scheduledAtMs),
		Number.POSITIVE_INFINITY
	);
	if (!Number.isFinite(nearestMs)) return null;

	const nearest = candidates.filter((candidate) => candidate.scheduledAtMs === nearestMs);
	return {
		scheduledAt: nearest[0].scheduledAt,
		scheduledAtMs: nearestMs,
		sources: nearest.map((candidate) => candidate.source),
	};
}

export function formatCountdown(remainingMs: number) {
	const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const time = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");

	return days > 0 ? `${days}일 ${time}` : time;
}

export function formatSourceSummary(sources: CrawlSourcePolicy["source"][]) {
	if (sources.length === 0) return "";
	const first = CRAWL_SOURCE_LABELS[sources[0]];
	return sources.length === 1 ? first : `${first} 외 ${sources.length - 1}개`;
}

export function getCorrectedNowMs(localNowMs: number, serverNow: string, dataUpdatedAt: number) {
	const serverNowMs = new Date(serverNow).getTime();
	if (!Number.isFinite(serverNowMs) || dataUpdatedAt <= 0) return localNowMs;
	return localNowMs + serverNowMs - dataUpdatedAt;
}

export function getDeadlineHandoffDurationMs(settings: CrawlPolicySettings) {
	const maxRunBudgetMs =
		Math.max(...settings.sources.map((policy) => policy.runBudgetSeconds)) * 1000;
	return Math.max(IDLE_REFETCH_INTERVAL_MS, maxRunBudgetMs + DEADLINE_HANDOFF_GRACE_MS);
}

export function getCrawlPolicyRefetchInterval(
	settings: CrawlPolicySettings | undefined,
	handoffActive: boolean
) {
	const activeRun = settings?.sources.some((policy) => policy.activeRunId !== null) ?? false;
	return handoffActive || activeRun ? ACTIVE_REFETCH_INTERVAL_MS : IDLE_REFETCH_INTERVAL_MS;
}

export function getInboxSchedulePresentation(
	settings: CrawlPolicySettings,
	nowMs: number,
	handoffActive = false
): InboxSchedulePresentation {
	const activeSources = settings.sources
		.filter((policy) => policy.activeRunId !== null)
		.map((policy) => policy.source);
	if (activeSources.length > 0) return { kind: "active", sources: activeSources };

	if (!settings.schedulerEnabled) {
		return { kind: "stopped", message: "예약 수집이 중지되어 있습니다." };
	}

	if (!settings.sources.some((policy) => policy.scheduleEnabled)) {
		return { kind: "stopped", message: "활성화된 예약 수집이 없습니다." };
	}

	if (handoffActive) {
		return { kind: "waiting", message: "수집 시작을 확인하고 있습니다." };
	}

	const schedule = selectNextCrawlSchedule(settings);
	if (!schedule) {
		return { kind: "waiting", message: "다음 수집 일정을 계산하고 있습니다." };
	}

	const remainingMs = Math.max(0, schedule.scheduledAtMs - nowMs);
	if (remainingMs === 0) {
		return { kind: "waiting", message: "수집 시작을 확인하고 있습니다." };
	}

	return { kind: "countdown", remainingMs, schedule };
}

function ScheduleStatus({ presentation }: { presentation: InboxSchedulePresentation }) {
	switch (presentation.kind) {
		case "countdown":
			return (
				<div
					className="mt-5 min-w-64 rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/60"
					data-testid="inbox-next-crawl"
				>
					<div className="text-muted-foreground text-xs">다음 수집까지</div>
					<div className="mt-1 font-mono font-semibold text-2xl tabular-nums tracking-tight">
						{formatCountdown(presentation.remainingMs)}
					</div>
					<div className="mt-1 text-muted-foreground text-sm">
						{formatSourceSummary(presentation.schedule.sources)}
					</div>
				</div>
			);
		case "active":
			return (
				<div className="mt-5 flex flex-col items-center gap-1 text-sm" role="status">
					<div className="flex items-center gap-2 font-medium">
						<Loader2 aria-hidden="true" className="size-4 animate-spin" />
						<span>{formatSourceSummary(presentation.sources)} 수집 중</span>
					</div>
					<span className="text-muted-foreground text-xs">
						완료되면 Inbox를 자동으로 갱신합니다.
					</span>
				</div>
			);
		case "stopped":
			return (
				<div className="mt-5 flex flex-col items-center gap-3">
					<p className="text-muted-foreground text-sm">{presentation.message}</p>
					<Button asChild size="sm" variant="outline">
						<Link href="/main/setting/crawling">수집 설정</Link>
					</Button>
				</div>
			);
		case "waiting":
			return (
				<div className="mt-5 flex items-center gap-2 text-muted-foreground text-sm" role="status">
					<Loader2 aria-hidden="true" className="size-4 animate-spin" />
					<span>{presentation.message}</span>
				</div>
			);
	}
}

export function InboxEmptyStateView({
	presentation,
	loading = false,
	error = false,
	retrying = false,
	onRetry,
}: {
	presentation?: InboxSchedulePresentation;
	loading?: boolean;
	error?: boolean;
	retrying?: boolean;
	onRetry?: () => void;
}) {
	return (
		<Card
			className="flex min-h-64 w-full flex-col items-center justify-center border-zinc-200/80 px-6 py-10 text-center shadow-none dark:border-zinc-800"
			data-testid="inbox-empty-state"
		>
			<div className="flex size-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
				<Inbox aria-hidden="true" className="size-5" />
			</div>
			<h3 className="mt-4 font-semibold text-lg">Inbox가 비어 있습니다</h3>
			<p className="mt-1 text-muted-foreground text-sm">
				새로 수집된 항목이 생기면 이곳에 표시됩니다.
			</p>

			{loading ? (
				<div className="mt-5 flex items-center gap-2 text-muted-foreground text-sm" role="status">
					<Clock3 aria-hidden="true" className="size-4" />
					<span>다음 수집 일정을 확인하고 있습니다.</span>
				</div>
			) : null}
			{error ? (
				<div className="mt-5 flex flex-col items-center gap-3">
					<p className="text-muted-foreground text-sm">다음 수집 일정을 불러오지 못했습니다.</p>
					<Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
						<RefreshCw
							aria-hidden="true"
							className={`mr-2 size-4 ${retrying ? "animate-spin" : ""}`}
						/>
						{retrying ? "다시 확인 중..." : "다시 시도"}
					</Button>
				</div>
			) : null}
			{presentation ? <ScheduleStatus presentation={presentation} /> : null}
		</Card>
	);
}

function completedRunFingerprint(policy: CrawlSourcePolicy) {
	if (!policy.latest?.finishedAt) return null;
	return [
		policy.latest.id,
		policy.latest.status,
		policy.latest.finishedAt,
		policy.latest.insertedCount,
	].join(":");
}

function updateCompletedRunFingerprints(
	settings: CrawlPolicySettings,
	fingerprints: Map<CrawlSourcePolicy["source"], string | null>,
	comparePrevious: boolean
) {
	let changed = false;
	for (const policy of settings.sources) {
		const current = completedRunFingerprint(policy);
		const previous = fingerprints.get(policy.source) ?? null;
		if (comparePrevious && current && current !== previous) changed = true;
		if (current) fingerprints.set(policy.source, current);
	}
	return changed;
}

export function InboxEmptyState() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [localNow, setLocalNow] = useState(() => Date.now());
	const [deadlineHandoff, setDeadlineHandoff] = useState<DeadlineHandoff | null>(null);
	const handledDeadlineRef = useRef<string | null>(null);
	const completedRunsRef = useRef(new Map<CrawlSourcePolicy["source"], string | null>());
	const completedRunsInitializedRef = useRef(false);
	const handoffActive = deadlineHandoff !== null && deadlineHandoff.expiresAtLocalMs > localNow;
	const query = useQuery({
		...trpc.crawlPolicy.get.queryOptions(),
		refetchInterval: (currentQuery) =>
			getCrawlPolicyRefetchInterval(currentQuery.state.data, handoffActive),
		refetchOnWindowFocus: "always",
	});

	useEffect(() => {
		const timer = window.setInterval(() => setLocalNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);

	const nowMs = query.data
		? getCorrectedNowMs(localNow, query.data.serverNow, query.dataUpdatedAt)
		: localNow;
	const presentation = query.data
		? getInboxSchedulePresentation(query.data, nowMs, handoffActive)
		: undefined;
	const nextSchedule = query.data ? selectNextCrawlSchedule(query.data) : null;
	const deadlineReached = nextSchedule ? nextSchedule.scheduledAtMs <= nowMs : false;

	useEffect(() => {
		if (!nextSchedule || !deadlineReached || !query.data) return;
		if (handledDeadlineRef.current === nextSchedule.scheduledAt) return;
		handledDeadlineRef.current = nextSchedule.scheduledAt;
		setDeadlineHandoff({
			scheduledAt: nextSchedule.scheduledAt,
			expiresAtLocalMs: Date.now() + getDeadlineHandoffDurationMs(query.data),
		});

		void Promise.allSettled([query.refetch(), invalidateThreadQueries(queryClient, ["inbox"])]);
	}, [deadlineReached, nextSchedule, query.data, query.refetch, queryClient]);

	useEffect(() => {
		if (!deadlineHandoff || deadlineHandoff.expiresAtLocalMs > localNow) return;
		setDeadlineHandoff(null);
	}, [deadlineHandoff, localNow]);

	useEffect(() => {
		if (!query.data) return;

		const activeRunObserved = query.data.sources.some((policy) => policy.activeRunId !== null);
		const completedRunChanged = updateCompletedRunFingerprints(
			query.data,
			completedRunsRef.current,
			completedRunsInitializedRef.current
		);
		if (!completedRunsInitializedRef.current) {
			completedRunsInitializedRef.current = true;
			return;
		}

		if (deadlineHandoff && (activeRunObserved || !query.data.schedulerEnabled)) {
			setDeadlineHandoff(null);
		}
		if (completedRunChanged) {
			setDeadlineHandoff(null);
			void invalidateThreadQueries(queryClient, ["inbox"]);
		}
	}, [deadlineHandoff, query.data, queryClient]);

	if (query.isPending && !query.data) {
		return <InboxEmptyStateView loading />;
	}
	if (query.isError && !query.data) {
		return (
			<InboxEmptyStateView
				error
				retrying={query.isFetching}
				onRetry={() => {
					void query.refetch();
				}}
			/>
		);
	}

	return <InboxEmptyStateView presentation={presentation} />;
}
