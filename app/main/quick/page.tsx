"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/utils/supabase/client";
import { DefaultThreadItem } from "../new-threads/thread-item";
import { ThreadLoading } from "../new-threads/thread-loading";
import NoDataBox from "../no-data";

export default function QuickPage() {
	return <QuickThread />;
}

const QuickThread = () => {
	const supabase = createClient();

	const { data, isLoading } = useQuery({
		queryKey: ["quick-save"],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("quick-save")
				.select()
				.order("created_at", { ascending: false })
				.order("id", { ascending: false });

			if (error) {
				throw new Error(error.message);
			}

			return data;
		},
	});

	return (
		<div className="flex w-full flex-col gap-2">
			{isLoading && <ThreadLoading />}
			{data && !data.length && <NoDataBox />}
			{data?.map((thread) => (
				<DefaultThreadItem key={thread.id} thread={thread} threadName="quick-save" />
			))}
		</div>
	);
};
