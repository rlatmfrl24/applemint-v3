import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const ThreadLoading = ({ count = 3 }: { count?: number }) => {
	return (
		<div className="space-y-2">
			{Array.from({ length: count }, (_, index) => (
				<Card key={index}>
					<CardContent className="mt-6 space-y-2">
						<Skeleton className="h-5 w-[250px] rounded-xl" />
						<Skeleton className="h-4 w-[250px]" />
						<Skeleton className="h-4 w-[200px]" />
					</CardContent>
				</Card>
			))}
		</div>
	);
};
