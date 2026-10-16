import { Skeleton } from "@/components/ui/skeleton";

export function BookmarkListSkeleton() {
	return (
		<div
			data-testid="bookmark-list-skeleton"
			role="status"
			aria-label="북마크를 불러오는 중"
			className="divide-y rounded-lg border motion-reduce:[&_*]:animate-none"
		>
			{[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
				<div key={index} className="flex min-h-[72px] items-center gap-3 px-3 py-2">
					<Skeleton className="size-4 shrink-0" />
					<div className="flex-1 space-y-2">
						<Skeleton className="h-4 w-2/3" />
						<Skeleton className="h-3 w-5/6" />
						<Skeleton className="h-3 w-1/3" />
					</div>
				</div>
			))}
		</div>
	);
}
