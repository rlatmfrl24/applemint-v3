"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ManualCrawlDialog({
	label,
	onClose,
	onConfirm,
}: {
	label: string;
	onClose: () => void;
	onConfirm: () => void | Promise<void>;
}) {
	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{label} 지금 수집</AlertDialogTitle>
					<AlertDialogDescription>
						예약 설정과 관계없이 즉시 실행합니다. 소스 잠금과 최대 동시성 제한은 유지됩니다.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>수집 시작</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
