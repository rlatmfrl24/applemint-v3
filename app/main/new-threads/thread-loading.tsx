import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const ThreadLoading = ({ count = 3 }: { count?: number }) => {
	return (
		<div className="space-y-2">
			{Array.from({ length: count }, (_, index) => (
				<Card key={index} className="w-full">
					<CardContent className="mt-6 space-y-2">
						<Skeleton className="h-5 w-full max-w-md rounded-xl" />
						<Skeleton className="h-4 w-full max-w-lg" />
						<Skeleton className="h-4 w-full max-w-sm" />
					</CardContent>
				</Card>
			))}
		</div>
	);
};
