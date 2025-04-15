import type { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence } from "framer-motion";
import { createClient } from "@/utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";
import { Card, CardHeader } from "@/components/ui/card";
import { QuickSaveButton } from "../quick-save-button";
import NoDataBox from "../no-data";
import { useMemo } from "react";

const TypeStats = ({ threads }: { threads: ThreadItemType[] | undefined }) => {
	const typeList = [
		{ type: "battlepage", name: "Battlepage" },
		{ type: "fmkorea", name: "Fmkorea" },
		{ type: "arcalive", name: "Arcalive" },
		{ type: "issuelink", name: "Issuelink" },
		{ type: "normal", name: "ETC" },
	];

	const typeCounts = useMemo(() => {
		if (!threads) return {};
		return typeList.reduce(
			(acc, { type }) => {
				acc[type] = threads.filter((thread) => thread.type === type).length;
				return acc;
			},
			{} as Record<string, number>,
		);
	}, [threads]);

	return (
		<Card>
			<CardHeader>
				<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
					{typeList.map((type) => (
						<div key={type.type} className="text-center p-2">
							<h5 className="text-sm md:text-base font-medium text-gray-600">
								{type.name}
							</h5>
							<span className="font-bold text-xl md:text-3xl">
								{typeCounts[type.type] || 0}
							</span>
						</div>
					))}
				</div>
			</CardHeader>
		</Card>
	);
};

export const NormalThreads = () => {
	const supabase = createClient();

	const {
		data: normalThreads,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["new-threads"],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("new-threads")
				.select()
				.neq("type", "media")
				.neq("type", "youtube")
				.order("created_at", { ascending: false })
				.order("id", { ascending: false });

			if (error) {
				console.error(error);
			}

			return data as ThreadItemType[];
		},
	});

	return (
		<div className="flex flex-col gap-4">
			<TypeStats threads={normalThreads} />
			{isLoading && <ThreadLoading />}
			{(!normalThreads || normalThreads.length === 0) && <NoDataBox />}
			<AnimatePresence>
				{normalThreads?.map((thread) => (
					<DefaultThreadItem
						key={thread.id}
						thread={thread}
						threadName="new-threads"
						extraButtons={<QuickSaveButton thread={thread} />}
					/>
				))}
			</AnimatePresence>
		</div>
	);
};
