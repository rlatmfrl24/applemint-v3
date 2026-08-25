"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { acknowledgeCurrentInboxBadge } from "@/lib/pwa-client";
import type { ThreadListFilterParam } from "@/lib/thread-list-contract";
import { threadStatsOptions } from "@/lib/thread-query-options";
import type { ThreadStats } from "@/lib/type-defs";
import { useTRPCClient } from "@/trpc/client";
import { ThreadInfiniteList } from "../thread-infinite-list";
import { InboxEmptyState } from "./inbox-empty-state";
import { QuickSaveButton } from "./quick-save-button";
import { DefaultThreadItem } from "./thread-item";

export type ThreadFilterSelection =
	| { kind: "all" }
	| { kind: "type"; type: string }
	| { kind: "host"; host: string };

const ALL_SELECTION: ThreadFilterSelection = { kind: "all" };

const hostFilterValue = (host: string) => `host:${encodeURIComponent(host)}`;

export function getThreadListFilterParams(
	selection: ThreadFilterSelection
): ThreadListFilterParam[] {
	if (selection.kind === "all") return [];
	if (selection.kind === "type") return [{ key: "filterType", value: selection.type }];
	return [
		{ key: "filterType", value: "normal" },
		{ key: "filterHost", value: selection.host },
	];
}

export function reconcileThreadFilterSelection(
	selection: ThreadFilterSelection,
	hostCounts: ThreadStats["hostCounts"]
): ThreadFilterSelection {
	if (
		selection.kind === "host" &&
		!hostCounts.some((hostCount) => hostCount.host === selection.host)
	) {
		return { kind: "type", type: "normal" };
	}
	return selection;
}

export const TypeStats = ({
	stats,
	selection,
	onSelectionChange,
}: {
	stats: ThreadStats | undefined;
	selection: ThreadFilterSelection;
	onSelectionChange: (selection: ThreadFilterSelection) => void;
}) => {
	const orderedTypeCounts = useMemo(() => {
		if (!stats) return [];
		const normal = stats.counts.filter((item) => item.key === "normal");
		const others = stats.counts.filter((item) => item.key !== "normal");
		return [...normal, ...others];
	}, [stats]);
	const selectedValue =
		selection.kind === "all"
			? "all"
			: selection.kind === "type"
				? `type:${selection.type}`
				: hostFilterValue(selection.host);

	return (
		<Card className="w-full border-zinc-200/80 shadow-none dark:border-zinc-800">
			<CardHeader className="p-3">
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={selectedValue}
					onValueChange={(value) => {
						if (!value) return;
						if (value === "all") {
							onSelectionChange(ALL_SELECTION);
							return;
						}
						const hostCount = stats?.hostCounts.find(
							(item) => hostFilterValue(item.host) === value
						);
						if (hostCount) {
							onSelectionChange({ kind: "host", host: hostCount.host });
							return;
						}
						if (value.startsWith("type:")) {
							onSelectionChange({ kind: "type", type: value.slice(5) });
						}
					}}
				>
					<div className="grid w-full grid-cols-2 gap-2 lg:flex lg:flex-wrap">
						<ToggleGroupItem
							value="all"
							className="flex justify-between gap-2 px-2"
							disabled={!stats}
						>
							<span className="font-medium text-xs sm:text-sm">All</span>
							<Badge className="px-1.5 py-0">{stats ? stats.totalCount : "-"}</Badge>
						</ToggleGroupItem>
						{orderedTypeCounts.map((type) => (
							<ToggleGroupItem
								key={type.key}
								value={`type:${type.key}`}
								className="flex justify-between gap-2 px-2"
							>
								<span className="font-medium text-xs sm:text-sm">{type.label}</span>
								<Badge className="px-1.5 py-0">{type.count}</Badge>
							</ToggleGroupItem>
						))}
						{stats?.hostCounts.map((hostCount) => (
							<ToggleGroupItem
								key={hostCount.host}
								value={hostFilterValue(hostCount.host)}
								className="flex justify-between gap-2 px-2"
							>
								<span className="font-medium text-xs sm:text-sm">Host · {hostCount.label}</span>
								<Badge className="px-1.5 py-0">{hostCount.count}</Badge>
							</ToggleGroupItem>
						))}
					</div>
				</ToggleGroup>
			</CardHeader>
		</Card>
	);
};

export const ThreadList = () => {
	const trpc = useTRPCClient();
	const [selection, setSelection] = useState<ThreadFilterSelection>(ALL_SELECTION);
	const selectionKey =
		selection.kind === "host"
			? hostFilterValue(selection.host)
			: selection.kind === "type"
				? `type:${selection.type}`
				: "all";

	const filterParams = useMemo(() => getThreadListFilterParams(selection), [selection]);

	const statsQuery = useQuery(threadStatsOptions(trpc, "inbox"));
	const acknowledgeInbox = async () => {
		await acknowledgeCurrentInboxBadge((endpoint) =>
			trpc.push.acknowledgeInbox.mutate({ endpoint })
		);
	};

	useEffect(() => {
		if (!statsQuery.data) return;
		setSelection((current) => reconcileThreadFilterSelection(current, statsQuery.data.hostCounts));
	}, [statsQuery.data]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!selectionKey) return;

		window.scrollTo({ top: 0, behavior: "smooth" });
	}, [selectionKey]);

	return (
		<div className="flex w-full flex-col gap-3">
			{statsQuery.data &&
				(statsQuery.data.counts.length > 0 || statsQuery.data.hostCounts.length > 0) && (
					<TypeStats
						stats={statsQuery.data}
						selection={selection}
						onSelectionChange={setSelection}
					/>
				)}
			<ThreadInfiniteList
				state="inbox"
				filters={filterParams}
				onInitialLoadSuccess={acknowledgeInbox}
				emptyState={selection.kind === "all" ? <InboxEmptyState /> : undefined}
				renderItem={(thread) => (
					<DefaultThreadItem
						thread={thread}
						threadState="inbox"
						extraButtons={<QuickSaveButton thread={thread} />}
					/>
				)}
			/>
		</div>
	);
};
