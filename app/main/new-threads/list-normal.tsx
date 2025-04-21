import type { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";
import { Card, CardHeader } from "@/components/ui/card";
import { QuickSaveButton } from "../quick-save-button";
import NoDataBox from "../no-data";
import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
		<Card className="mb-4">
			<CardHeader>
				<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
					{typeList.map((type) => (
						<motion.div
							key={type.type}
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.3 }}
							className="text-center p-2 rounded-lg transition-colors"
						>
							<h5 className="text-sm md:text-base font-medium text-gray-600">
								{type.name}
							</h5>
							<span className="font-bold text-xl md:text-3xl text-primary">
								{typeCounts[type.type] || 0}
							</span>
						</motion.div>
					))}
				</div>
			</CardHeader>
		</Card>
	);
};

const ThreadList = ({ threads }: { threads: ThreadItemType[] }) => {
	return (
		<AnimatePresence mode="popLayout">
			{threads.map((thread) => (
				<motion.div
					key={thread.id}
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -20 }}
					transition={{ duration: 0.2 }}
				>
					<DefaultThreadItem
						thread={thread}
						threadName="new-threads"
						extraButtons={<QuickSaveButton thread={thread} />}
					/>
				</motion.div>
			))}
		</AnimatePresence>
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
				throw new Error(error.message);
			}

			return data as ThreadItemType[];
		},
	});

	if (error) {
		return (
			<Alert variant="destructive" className="mb-4">
				<AlertCircle className="h-4 w-4" />
				<AlertTitle>에러 발생</AlertTitle>
				<AlertDescription>
					데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<TypeStats threads={normalThreads} />
			{isLoading ? (
				<div className="space-y-4">
					<ThreadLoading />
					<ThreadLoading />
					<ThreadLoading />
				</div>
			) : !normalThreads || normalThreads.length === 0 ? (
				<NoDataBox />
			) : (
				<ThreadList threads={normalThreads} />
			)}
		</div>
	);
};
