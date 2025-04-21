import type { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";
import { Card, CardHeader } from "@/components/ui/card";
import { QuickSaveButton } from "../quick-save-button";
import NoDataBox from "../no-data";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

const TypeStats = ({
	threads,
	selectedType,
	onTypeChange,
}: {
	threads: ThreadItemType[] | undefined;
	selectedType: string;
	onTypeChange: (type: string) => void;
}) => {
	const typeList = [] as {
		type: string;
		count: number;
	}[];

	threads?.map((thread) => {
		if (thread.type === "arcalive" || thread.type === "battlepage") {
			const existingType = typeList.find((type) => type.type === thread.type);
			if (existingType) {
				existingType.count++;
			} else {
				typeList.push({ type: thread.type, count: 1 });
			}
		}
		if (thread.type === "issuelink") {
			const issueLinkType = thread.tag?.[1] ?? "unknown";

			const existingType = typeList.find((type) => type.type === issueLinkType);
			if (existingType) {
				existingType.count++;
			} else {
				typeList.push({ type: issueLinkType, count: 1 });
			}
		}
		if (thread.type === "normal") {
			const existingType = typeList.find((type) => type.type === thread.type);
			if (existingType) {
				existingType.count++;
			} else {
				typeList.push({ type: thread.type, count: 1 });
			}
		}
	});

	//merge unknown type if count is under 5
	const mergedTypeList = typeList.filter((type) => type.count >= 5);
	mergedTypeList.push({
		type: "unknown",
		count: typeList
			.filter((type) => type.count < 5)
			.reduce((acc, type) => acc + type.count, 0),
	});

	return (
		<Card className="mb-1">
			<CardHeader>
				<ToggleGroup
					type="single"
					value={selectedType}
					onValueChange={onTypeChange}
				>
					<ToggleGroupItem value="all">
						<span className="text-sm md:text-xl font-medium">All</span>
						<Badge>{threads?.length}</Badge>
					</ToggleGroupItem>
					{mergedTypeList.map((type) => (
						<ToggleGroupItem key={type.type} value={type.type}>
							<span className="text-sm md:text-lg font-medium">
								{type.type}
							</span>
							<Badge>{type.count}</Badge>
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</CardHeader>
		</Card>
	);
};

const ThreadList = ({ threads }: { threads: ThreadItemType[] }) => {
	return (
		<AnimatePresence>
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
	const [selectedType, setSelectedType] = useState("all");

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

	const filteredThreads = normalThreads?.filter((thread) => {
		if (selectedType === "all") return true;
		if (selectedType === "unknown") {
			// 5개 미만의 스레드를 가진 타입들만 필터링
			const typeCounts = new Map<string, number>();
			for (const t of normalThreads || []) {
				const type =
					t.type === "issuelink" ? (t.tag?.[1] ?? "unknown") : t.type;
				typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
			}

			const threadType =
				thread.type === "issuelink"
					? (thread.tag?.[1] ?? "unknown")
					: thread.type;
			return (typeCounts.get(threadType) || 0) < 5;
		}
		if (thread.type === "issuelink") {
			return thread.tag?.[1] === selectedType;
		}
		return thread.type === selectedType;
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
			{normalThreads?.length !== 0 && (
				<TypeStats
					threads={normalThreads}
					selectedType={selectedType}
					onTypeChange={setSelectedType}
				/>
			)}
			{isLoading ? (
				<div className="space-y-4">
					<ThreadLoading />
					<ThreadLoading />
					<ThreadLoading />
				</div>
			) : !filteredThreads || filteredThreads.length === 0 ? (
				<NoDataBox />
			) : (
				<ThreadList threads={filteredThreads} />
			)}
		</div>
	);
};
