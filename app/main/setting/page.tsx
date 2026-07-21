"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { invalidateThreadQueries } from "@/lib/thread-query-cache";
import { createClient } from "@/utils/supabase/client";
import { ManualCrawlError, requestManualCrawl, withLoadingState } from "./crawl-client";

function formatManualCrawlError(error: unknown) {
	return JSON.stringify(
		{
			error: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
			httpStatus: error instanceof ManualCrawlError ? error.httpStatus : null,
			response: error instanceof ManualCrawlError ? error.responseBody : null,
		},
		null,
		2
	);
}

export default function SettingPage() {
	const [result, setResult] = useState<string>("아직 크롤링 결과가 없습니다.");
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [bulkDeleteStatus, setBulkDeleteStatus] = useState<string>(
		"아직 일괄 이동을 실행하지 않았습니다."
	);
	const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
	const supabase = createClient();
	const queryClient = useQueryClient();
	const handleCrawl = async (target: string) => {
		await withLoadingState(setIsLoading, async () => {
			try {
				const crawlResult = await requestManualCrawl(target);
				setResult(JSON.stringify(crawlResult, null, 2));
				await invalidateThreadQueries(queryClient, ["new-threads"]);
			} catch (error) {
				setResult(formatManualCrawlError(error));
			}
		});
	};

	const crawlerTrigger = (title: string, target: string) => {
		return (
			<AlertDialog>
				<AlertDialogTrigger className="h-full w-full" asChild>
					<Button className="h-full w-full">{title}</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{title}</AlertDialogTitle>
						<AlertDialogDescription>
							서버 동작에 무리를 줄 수 있는 동작입니다.
							<br /> 만약 최근에 크롤링을 진행했다면 추가 크롤링을 진행하지 않도록 주의해주세요.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={isLoading}
							onClick={async () => {
								await handleCrawl(target);
							}}
						>
							Crawl
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	};

	const handleBulkDelete = async () => {
		await withLoadingState(setIsBulkDeleting, async () => {
			try {
				const { data, error } = await supabase.rpc("bulk_move_new_threads_to_trash");

				if (error) {
					throw error;
				}

				const movedCount = Number(data ?? 0);
				setBulkDeleteStatus(`총 ${movedCount}개의 스레드를 휴지통으로 이동했습니다.`);
				await invalidateThreadQueries(queryClient, ["new-threads", "trash"]);
			} catch (error) {
				console.error("신규 스레드 일괄 이동 중 오류", error);
				if (error instanceof Error) {
					setBulkDeleteStatus(`이동 실패: ${error.message}`);
				} else {
					setBulkDeleteStatus("이동 실패: 알 수 없는 오류가 발생했습니다.");
				}
			}
		});
	};

	return (
		<div className="flex h-full w-full flex-1 flex-col">
			<h2>Manual Crawling</h2>
			<div className="mt-4 grid grid-cols-4 gap-2">
				{crawlerTrigger("Crawl Arcalive", "arcalive")}
				{crawlerTrigger("Crawl Battlepage", "battlepage")}
				{crawlerTrigger("Crawl Insagirl", "insagirl")}
				{crawlerTrigger("Crawl IssueLink", "issuelink")}
			</div>
			<p className="mt-4">Crawl Result</p>
			<Textarea
				aria-label="크롤링 결과"
				className="w-full"
				value={isLoading ? "Loading..." : result}
				disabled={isLoading}
				readOnly
			/>
			<h2 className="mt-8">신규 스레드 관리</h2>
			<p className="mt-2 text-muted-foreground text-sm">
				모든 신규 스레드를 원자적으로 휴지통으로 이동합니다. 실행 전에 반드시 확인해주세요.
			</p>
			<div className="mt-4 max-w-xs">
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button className="w-full" variant="destructive" disabled={isBulkDeleting}>
							{isBulkDeleting ? "이동 중..." : "모두 휴지통으로 이동"}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>모든 신규 스레드 이동</AlertDialogTitle>
							<AlertDialogDescription>
								모든 신규 스레드를 휴지통으로 이동합니다. 계속하시겠습니까?
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={isBulkDeleting}>취소</AlertDialogCancel>
							<AlertDialogAction
								disabled={isBulkDeleting}
								onClick={async () => {
									await handleBulkDelete();
								}}
							>
								이동 진행
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
			<Textarea
				aria-label="일괄 이동 결과"
				className="mt-4 w-full"
				value={isBulkDeleting ? "이동을 진행 중입니다..." : bulkDeleteStatus}
				disabled={isBulkDeleting}
				readOnly
			/>
		</div>
	);
}
