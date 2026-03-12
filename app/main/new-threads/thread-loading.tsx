import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const ThreadLoading = ({ count = 3 }: { count?: number }) => {
	const skeletonKeys = Array.from(
		{ length: count },
		(_, index) => `thread-loading-${count}-${index + 1}`
	);

	return (
		<div className="space-y-2">
			{skeletonKeys.map((key) => (
				<Card key={key} className="w-full border-zinc-200/80 shadow-none dark:border-zinc-800">
					<CardContent className="space-y-3 p-3">
						<div className="flex gap-2">
							<Skeleton className="h-5 w-16 rounded-full" />
							<Skeleton className="h-5 w-20 rounded-full" />
						</div>
						<Skeleton className="h-5 w-full max-w-xl rounded-md" />
						<Skeleton className="h-3.5 w-full max-w-2xl rounded-md" />
						<Skeleton className="h-8 w-full max-w-xs rounded-md" />
					</CardContent>
				</Card>
			))}
		</div>
	);
};
