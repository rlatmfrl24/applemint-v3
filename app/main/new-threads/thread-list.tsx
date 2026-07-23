"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ThreadListFilterParam } from "@/lib/thread-list-contract";
import { threadStatsOptions } from "@/lib/thread-query-options";
import { ThreadInfiniteList } from "../thread-infinite-list";
import { QuickSaveButton } from "./quick-save-button";
import { DefaultThreadItem } from "./thread-item";

interface ThreadStatsItem {
	key: string;
	label: string;
	count: number;
}

const TypeStats = ({
	stats,
	selectedType,
	onTypeChange,
}: {
	stats: ThreadStatsItem[] | undefined;
	selectedType: string;
	onTypeChange: (type: string) => void;
}) => {
	const totalCount = stats?.reduce((acc, type) => acc + type.count, 0) ?? 0;

	return (
		<Card className="w-full border-zinc-200/80 shadow-none dark:border-zinc-800">
			<CardHeader className="p-3">
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={selectedType}
					onValueChange={(value) => {
						if (!value) return;
						onTypeChange(value);
					}}
				>
					<div className="grid w-full grid-cols-2 gap-2 lg:flex lg:flex-wrap">
						<ToggleGroupItem
							value="all"
							className="flex justify-between gap-2 px-2"
							disabled={!stats}
						>
							<span className="font-medium text-xs sm:text-sm">All</span>
							<Badge className="px-1.5 py-0">{stats ? totalCount : "-"}</Badge>
						</ToggleGroupItem>
						{stats?.map((type) => (
							<ToggleGroupItem
								key={type.key}
								value={type.key}
								className="flex justify-between gap-2 px-2"
							>
								<span className="font-medium text-xs sm:text-sm">{type.label}</span>
								<Badge className="px-1.5 py-0">{type.count}</Badge>
							</ToggleGroupItem>
						))}
					</div>
				</ToggleGroup>
			</CardHeader>
		</Card>
	);
};

export const ThreadList = () => {
	const [selectedType, setSelectedType] = useState("all");

	const filterParams = useMemo(() => {
		const params: ThreadListFilterParam[] = [];

		if (selectedType !== "all") {
			params.push({ key: "filterType", value: selectedType });
		}

		return params;
	}, [selectedType]);

	const statsQuery = useQuery(threadStatsOptions("inbox"));

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (!selectedType) {
			return;
		}

		window.scrollTo({ top: 0, behavior: "smooth" });
	}, [selectedType]);

	return (
		<div className="flex w-full flex-col gap-3">
			{statsQuery.data?.counts && statsQuery.data.counts.length > 0 && (
				<TypeStats
					stats={statsQuery.data.counts}
					selectedType={selectedType}
					onTypeChange={setSelectedType}
				/>
			)}
			<ThreadInfiniteList
				state="inbox"
				filters={filterParams}
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
