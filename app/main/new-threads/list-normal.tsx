import type { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence } from "framer-motion";
import { createClient } from "@/utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";
import { Card, CardHeader } from "@/components/ui/card";
import { QuickSaveButton } from "../quick-save-button";
import NoDataBox from "../no-data";

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
				.or(
					"type.eq.normal,type.eq.fmkorea,type.eq.battlepage,type.eq.arcalive",
				)
				.order("created_at", { ascending: false })
				.order("id", { ascending: false });

			if (error) {
				console.error(error);
			}

			return data as ThreadItemType[];
		},
	});

	return (
		<div className="flex flex-col gap-2">
			<Card>
				<CardHeader>
					<div className="flex">
						<div className="flex-1 text-center">
							<h5>Battlepage</h5>
							<span className="font-bold text-2xl md:text-5xl">
								{
									normalThreads?.filter(
										(thread) => thread.type === "battlepage",
									).length
								}
							</span>
						</div>
						<div className="flex-1 text-center">
							<h5>Fmkorea</h5>
							<span className="font-bold text-2xl md:text-5xl">
								{
									normalThreads?.filter((thread) => thread.type === "fmkorea")
										.length
								}
							</span>
						</div>
						<div className="flex-1 text-center">
							<h5>Arcalive</h5>
							<span className="font-bold text-2xl md:text-5xl">
								{
									normalThreads?.filter((thread) => thread.type === "arcalive")
										.length
								}
							</span>
						</div>
						<div className="flex-1 text-center">
							<h5>ETC</h5>
							<span className="font-bold text-2xl md:text-5xl">
								{
									normalThreads?.filter((thread) => thread.type === "normal")
										.length
								}
							</span>
						</div>
					</div>
				</CardHeader>
			</Card>
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
