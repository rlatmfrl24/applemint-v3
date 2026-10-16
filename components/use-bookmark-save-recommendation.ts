"use client";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { collectionForHost } from "@/lib/bookmark-host";
import { recommendationRequest, registerRecommendationOnce } from "@/lib/bookmark-save-request";
import { useTRPCClient } from "@/trpc/client";
import type { Source } from "./bookmark-save-form";

async function prepareRecommendation(
	cache: QueryClient,
	trpc: ReturnType<typeof useTRPCClient>,
	id: string,
	url: string,
	title: string,
	renew: boolean
) {
	const current = await cache.fetchQuery({
		queryKey: ["bookmarks", "collections"],
		queryFn: () => trpc.bookmarkCollection.list.query(),
		staleTime: 0,
	});
	const match = collectionForHost(url, current);
	if (match) return { collection: match };
	const config = await cache.fetchQuery({
		queryKey: ["bookmarks", "configuration"],
		queryFn: () => trpc.bookmarkImport.configuration.query(),
		staleTime: 30000,
	});
	if (!config.openrouter) throw new Error("AI 설정이 없어 수동으로 저장할 수 있습니다.");
	const requestId = recommendationRequest(cache, { id, url }, title, renew);
	return registerRecommendationOnce(cache, requestId, (requestId) =>
		trpc.bookmarkAI.recommend.mutate({ threadId: id, title, requestId })
	);
}
export function useBookmarkSaveRecommendation(source: Source, recommendationId?: string) {
	const sourceId = source.id;
	const sourceUrl = source.url;
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const [title, setTitle] = useState(source.title);
	const titleRef = useRef(title);
	titleRef.current = title;
	const [selection, setSelection] = useState<{ id: string | null; version?: number }>({ id: null });
	const [jobId, setJobId] = useState(recommendationId);
	const [applied, setApplied] = useState<string>();
	const [preparing, setPreparing] = useState(!recommendationId);
	const [applying, setApplying] = useState(false);
	const [manual, setManual] = useState(false);
	const manualRef = useRef(false);
	const [message, setMessage] = useState<string>();
	const [origin, setOrigin] = useState<string>();
	const [slow, setSlow] = useState(false);
	const generation = useRef(0);
	const handled = useRef<string | undefined>(undefined);
	const revision = useRef(0);
	const requestRevision = useRef(0);
	const collections = useQuery({
		queryKey: ["bookmarks", "collections"],
		queryFn: () => trpc.bookmarkCollection.list.query(),
	});
	const config = useQuery({
		queryKey: ["bookmarks", "configuration"],
		queryFn: () => trpc.bookmarkImport.configuration.query(),
	});
	const recommendation = useQuery({
		queryKey: ["bookmarks", "recommendation", jobId],
		queryFn: () => {
			if (!jobId) throw new Error("추천 작업이 없습니다.");
			return trpc.bookmarkAI.recommendation.query({ id: jobId });
		},
		enabled: Boolean(jobId),
		retry: false,
		refetchInterval: (query) =>
			query.state.data && ["queued", "processing", "retry"].includes(query.state.data.job.state)
				? 1000
				: false,
	});
	const requesting =
		Boolean(jobId) &&
		!recommendation.error &&
		(!recommendation.data ||
			["queued", "processing", "retry"].includes(recommendation.data.job.state));
	const busy =
		!manual &&
		(preparing ||
			applying ||
			requesting ||
			Boolean(jobId && handled.current !== jobId && !recommendation.error));
	const start = useCallback(
		async (renew = false) => {
			const currentGeneration = ++generation.current;
			manualRef.current = false;
			setManual(false);
			setPreparing(true);
			setMessage(undefined);
			setOrigin(undefined);
			setApplied(undefined);
			setJobId(undefined);
			handled.current = undefined;
			const draft = titleRef.current.trim();
			requestRevision.current = revision.current;
			try {
				const result = await prepareRecommendation(cache, trpc, sourceId, sourceUrl, draft, renew);
				if (generation.current !== currentGeneration) return;
				if ("collection" in result) {
					setSelection({ id: result.collection.id, version: result.collection.version });
					setOrigin("사이트 일치");
				} else setJobId(result.id);
			} catch (error) {
				if (generation.current === currentGeneration)
					setMessage(
						error instanceof Error
							? error.message
							: "추천을 준비하지 못했습니다. 수동으로 저장할 수 있습니다."
					);
			} finally {
				if (generation.current === currentGeneration) setPreparing(false);
			}
		},
		[cache, trpc, sourceId, sourceUrl]
	);
	useEffect(() => {
		if (!recommendationId) void start();
		return () => {
			generation.current++;
		};
	}, [start, recommendationId]);
	useEffect(() => {
		if (!busy) {
			setSlow(false);
			return;
		}
		const timer = setTimeout(() => setSlow(true), 30000);
		return () => clearTimeout(timer);
	}, [busy]);
	useEffect(() => {
		const data = recommendation.data;
		if (
			!jobId ||
			!data ||
			manualRef.current ||
			handled.current === jobId ||
			["queued", "processing", "retry"].includes(data.job.state)
		)
			return;
		const result = data.recommendation;
		if (data.job.state !== "succeeded" || !result) {
			handled.current = jobId;
			setMessage(data.job.error ?? "추천을 완료하지 못했습니다. 직접 선택해 저장할 수 있습니다.");
			return;
		}
		if (
			data.job.scope.threadId !== source.id ||
			data.job.scope.url !== source.url ||
			data.job.scope.title !== titleRef.current.trim() ||
			requestRevision.current !== revision.current
		) {
			handled.current = jobId;
			setMessage("입력을 변경해 이전 추천을 적용하지 않았습니다. 필요하면 다시 추천받아주세요.");
			return;
		}
		let active = true;
		setApplying(true);
		void cache
			.fetchQuery({
				queryKey: ["bookmarks", "collections"],
				queryFn: () => trpc.bookmarkCollection.list.query(),
				staleTime: 0,
			})
			.then((current) => {
				if (!active || manualRef.current) return;
				const target = current.find((collection) => collection.id === result.collectionId);
				if (result.collectionId && target?.version !== result.collectionVersion)
					throw new Error("추천 컬렉션이 변경되었습니다. 다시 추천받거나 직접 선택해주세요.");
				if (
					titleRef.current.trim() !== String(data.job.scope.title) ||
					requestRevision.current !== revision.current
				)
					throw new Error("입력이 변경되어 이전 추천을 적용하지 않았습니다.");
				setSelection({ id: result.collectionId, version: result.collectionVersion ?? undefined });
				setApplied(jobId);
				setOrigin("AI 추천");
			})
			.catch((error: unknown) => {
				if (active)
					setMessage(error instanceof Error ? error.message : "추천을 적용하지 못했습니다.");
			})
			.finally(() => {
				if (active) {
					handled.current = jobId;
					setApplying(false);
				}
			});
		return () => {
			active = false;
		};
	}, [jobId, recommendation.data, cache, trpc, source]);
	function useManual() {
		generation.current++;
		manualRef.current = true;
		setManual(true);
		setPreparing(false);
		setApplying(false);
		setApplied(undefined);
		setOrigin(undefined);
		setMessage(undefined);
		setOrigin("직접 선택");
	}
	function changeTitle(value: string) {
		revision.current++;
		setTitle(value);
		setApplied(undefined);
		setOrigin(undefined);
	}
	function choose(id: string | null) {
		revision.current++;
		setSelection({ id, version: collections.data?.find((entry) => entry.id === id)?.version });
		setApplied(undefined);
		setOrigin("직접 선택");
	}
	return {
		collections,
		config,
		title,
		selection,
		jobId,
		applied,
		setApplied,
		message,
		setMessage,
		origin,
		busy,
		slow,
		start,
		useManual,
		changeTitle,
		choose,
		recommendation,
	};
}
