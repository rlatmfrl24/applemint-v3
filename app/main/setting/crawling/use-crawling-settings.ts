"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { CrawlSourcePolicy } from "@/lib/crawl-policy-contract";
import { CRAWL_RUNS_QUERY_KEY } from "@/lib/crawl-run-query-options";
import { invalidateThreadQueries } from "@/lib/thread-query-cache";
import { useTRPC } from "@/trpc/client";
import { ManualCrawlError, requestManualCrawl } from "../crawl-client";

export interface ManualCrawlResult {
	source: CrawlSourcePolicy["source"];
	success: boolean;
	message: string;
}

function getManualErrorMessage(error: unknown) {
	if (error instanceof ManualCrawlError) return `${error.message} (HTTP ${error.httpStatus})`;
	if (error instanceof Error) return error.message;
	return "수집 요청에 실패했습니다.";
}

export function useCrawlingSettings() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [localNow, setLocalNow] = useState(() => Date.now());
	const [manualSource, setManualSource] = useState<CrawlSourcePolicy["source"] | null>(null);
	const [manualResult, setManualResult] = useState<ManualCrawlResult | null>(null);
	const query = useQuery({
		...trpc.crawlPolicy.get.queryOptions(),
		refetchInterval: 60_000,
		refetchOnWindowFocus: true,
	});

	useEffect(() => {
		const timer = window.setInterval(() => setLocalNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);

	const serverOffset = query.data
		? new Date(query.data.serverNow).getTime() - query.dataUpdatedAt
		: 0;
	const nowMs = localNow + serverOffset;

	const handleManualCrawl = async (source: CrawlSourcePolicy["source"]) => {
		setManualSource(source);
		setManualResult(null);
		try {
			const result = await requestManualCrawl(source);
			const message = `${result.insertedCount}건 저장 · ${result.skippedCount}건 중복 · 경고 ${result.warningCount}건`;
			setManualResult({ source, success: true, message });
			const label = query.data?.sources.find((policy) => policy.source === source)?.label ?? source;
			toast.success(`${label} 수집이 완료되었습니다.`);
			await invalidateThreadQueries(queryClient, ["inbox"]);
		} catch (error) {
			const message = getManualErrorMessage(error);
			setManualResult({ source, success: false, message });
			toast.error(message);
		} finally {
			setManualSource(null);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.crawlPolicy.get.queryKey() }),
				queryClient.invalidateQueries({ queryKey: CRAWL_RUNS_QUERY_KEY }),
			]);
		}
	};

	return {
		query,
		nowMs,
		manualSource,
		manualResult,
		handleManualCrawl,
	};
}
