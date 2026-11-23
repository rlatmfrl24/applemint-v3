import { Clock3, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function InboxEmptyCard({ children, loading }: { children?: ReactNode; loading?: boolean }) {
	return (
		<Card
			className="flex min-h-64 w-full flex-col items-center justify-center border-zinc-200/80 px-6 py-10 text-center shadow-none dark:border-zinc-800"
			data-testid="inbox-empty-state"
		>
			<div className="flex size-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
				<Inbox aria-hidden="true" className="size-5" />
			</div>
			<h3 className="mt-4 text-lg font-semibold">Inbox가 비어 있습니다</h3>
			<p className="text-muted-foreground mt-1 text-sm">
				새로 수집된 항목이 생기면 이곳에 표시됩니다.
			</p>

			{loading ? (
				<div className="text-muted-foreground mt-5 flex items-center gap-2 text-sm" role="status">
					<Clock3 aria-hidden="true" className="size-4" />
					<span>다음 수집 일정을 확인하고 있습니다.</span>
				</div>
			) : null}
			{children}
		</Card>
	);
}
