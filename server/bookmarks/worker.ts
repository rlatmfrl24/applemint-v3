import "server-only";
import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";
import {
	bookmarkCollectionSchema,
	bookmarkJobSchema,
	bookmarkSchema,
} from "@/contracts/bookmark.schema";
import type { Json } from "@/types/database.types";
import type { AppSupabaseClient } from "@/types/supabase";
import {
	AI_INPUT_LIMIT,
	AI_OUTPUT_LIMIT,
	buildAIRequest,
	callBookmarkAI,
	countAIInput,
	reserveNano,
	validateAIItems,
} from "./ai";
import { type HealthWork, processHealthClaim } from "./health-worker";
import { collectionDigest, importVerified } from "./import-verification";
import { parseRaindropPage, raindropManifest, readRaindrop } from "./raindrop";
import {
	buildRecommendationRequest,
	callRecommendation,
	recommendationReservation,
} from "./recommendation";
import { safeFetch } from "./safe-fetch";

const claimSchema = z.object({
	job: bookmarkJobSchema,
	items: z.array(
		bookmarkSchema.extend({
			expected_version: z.number().int(),
			duplicate_count: z.number().int().optional(),
			previous: z.unknown().nullable(),
			work: z.custom<HealthWork>().nullable().optional(),
			baseline: z
				.object({
					checkId: z.uuid(),
					url: z.string(),
					observedAt: z.string(),
					title: z.string(),
					textHash: z.string(),
					textLength: z.number(),
					mediaReachable: z.number(),
				})
				.nullable()
				.optional(),
		})
	),
	collections: z.array(bookmarkCollectionSchema),
	settings: z.object({ interests: z.array(z.string()), interest_version: z.number().int() }),
});
type Claim = z.infer<typeof claimSchema>;
type Commit = { state?: string; error?: string; items?: object[]; [key: string]: unknown };

async function context(db: AppSupabaseClient) {
	const { data, error } = await db.rpc("bookmark_worker_context");
	if (error) throw new Error("WORKER_CONTEXT_FAILED");
	return z
		.object({
			importedCount: z.number().int(),
			importCollections: z.array(
				z.object({ sourceId: z.string(), name: z.string(), parentSourceId: z.string().nullable() })
			),
			verifiedCount: z.number().int(),
			missingSourceCount: z.number().int(),
			extraSourceCount: z.number().int(),
			changedMembershipCount: z.number().int(),
			collectionCount: z.number().int(),
			missingMembershipCount: z.number().int(),
			tagCounts: z.array(z.object({ tag: z.string(), count: z.number().int() })),
		})
		.parse(data);
}

async function verifyImport(
	db: AppSupabaseClient,
	job: Claim["job"],
	token: string | undefined
): Promise<Commit> {
	const manifest = await raindropManifest(token);
	const stored = await context(db);
	const verified = importVerified(manifest, stored, Number(job.progress.verifyReadCount ?? 0));
	return {
		state: verified ? "succeeded" : "partial",
		completed: stored.importedCount,
		failed: Math.max(
			stored.missingSourceCount,
			stored.extraSourceCount,
			stored.changedMembershipCount,
			Math.abs(manifest.total - stored.verifiedCount)
		),
		progress: {
			phase: "verified",
			storedCount: stored.importedCount,
			verified,
			sourceCount: manifest.total,
			verifiedCount: stored.verifiedCount,
			missingSourceCount: stored.missingSourceCount,
			extraSourceCount: stored.extraSourceCount,
			changedMembershipCount: stored.changedMembershipCount,
			collectionVerified:
				collectionDigest(
					manifest.collections.map((c) => ({
						sourceId: c.sourceId,
						name: c.name,
						parentSourceId: c.original.parentSourceId,
					}))
				) === collectionDigest(stored.importCollections),
		},
		error: verified
			? undefined
			: "원본 ID·소속·컬렉션 구조가 일치하지 않습니다. Raindrop 변경을 멈추고 재개해주세요. 이미 가져온 원본이 삭제·이동된 경우 자동 삭제나 덮어쓰기를 하지 않습니다.",
	};
}

async function importPage(
	db: AppSupabaseClient,
	claim: Claim,
	accountId: string,
	token: string | undefined
): Promise<Commit> {
	const { job } = claim;
	const page = typeof job.progress.page === "number" ? job.progress.page : 0;
	if (job.progress.accountId !== undefined && accountId !== job.progress.accountId)
		return {
			state: "paused",
			error: "Raindrop 계정이 변경되었습니다. 최초 계정 토큰으로 재개해주세요.",
		};
	if (job.progress.phase === "manifest" || job.progress.accountId === undefined) {
		const manifest = await raindropManifest(token);
		return {
			importCollections: manifest.collections,
			total: manifest.total,
			progress: {
				page: 0,
				accountId: manifest.accountId,
				free: manifest.free,
				expectedCollections: manifest.collections.length,
				readCount: 0,
				storedCount: 0,
				phase: "pages",
			},
			state: "retry",
		};
	}
	const pages = await Promise.all(
		[page, page + 1].map((index) =>
			readRaindrop(`raindrops/0?perpage=50&page=${index}&sort=created`, token)
		)
	);
	const items = pages.flatMap(parseRaindropPage);
	if (items.length === 0 && job.progress.phase !== "verify")
		return {
			resetVerification: true,
			state: "retry",
			progress: { phase: "verify", page: 0, verifyReadCount: 0 },
		};
	if (items.length === 0) {
		return verifyImport(db, job, token);
	}
	if (job.progress.phase === "verify")
		return {
			verifyItems: items.map((i) => ({
				sourceId: i.sourceId,
				collectionSourceId: i.collectionSourceId,
			})),
			state: "retry",
			progress: {
				phase: "verify",
				page: page + 2,
				verifyReadCount: Number(job.progress.verifyReadCount ?? 0) + items.length,
			},
		};
	return {
		importItems: items,
		completed: Math.min(job.total, job.completed + items.length),
		progress: {
			page: page + 2,
			readCount: Number(job.progress.readCount ?? 0) + items.length,
			phase: "pages",
		},
		state: "retry",
	};
}

async function enrich(claim: Claim): Promise<Commit> {
	const item = claim.items[0];
	if (!item) return {};
	try {
		const response = await safeFetch(item.url, { maxBytes: 524288 });
		if (response.status < 200 || response.status >= 300 || !response.contentType.includes("html"))
			throw new Error("NO_HTML_METADATA");
		const $ = load(response.body);
		const title = ($('meta[property="og:title"]').attr("content") || $("title").first().text())
			.trim()
			.slice(0, 1000);
		const description = (
			$('meta[name="description"]').attr("content") ||
			$('meta[property="og:description"]').attr("content") ||
			""
		)
			.trim()
			.slice(0, 4000);
		return {
			items: [{ id: item.id, version: item.expected_version, metadata: { title, description } }],
		};
	} catch {
		return {
			items: [
				{ id: item.id, state: "failed", error: "제목·설명 수집 실패. 저장한 북마크는 유지됩니다." },
			],
		};
	}
}

function validatedAIResult(
	kind: "classify" | "review" | "interests",
	output: NonNullable<Awaited<ReturnType<typeof callBookmarkAI>>["output"]>,
	claim: Claim,
	items: Claim["items"]
): Commit {
	const collections = claim.collections;
	if (kind === "interests") {
		if (output.items.length) throw new Error("INVALID_INTERESTS_OUTPUT");
		return {
			interests: output.interests,
			state: "succeeded",
			completed: 1,
		};
	}
	const proposals = validateAIItems(
		output.items,
		items.map((i) => i.id),
		collections.map((c) => c.id)
	);
	if (
		output.interests.length ||
		(kind === "review" && proposals.some((p) => p.collectionId || p.newCollectionName))
	)
		throw new Error("INVALID_AI_TASK_OUTPUT");
	return {
		interestVersion: claim.settings.interest_version,
		items: proposals.map((p) => ({
			result: {
				reviewCandidate: p.reviewCandidate,
				reason: p.reason,
				relevance: claim.settings.interests.length ? p.relevance : null,
			},
			id: p.id,
			version: items.find((i) => i.id === p.id)?.version,
			reviewRevision: items.find((i) => i.id === p.id)?.review_revision,
			...(kind === "review" && !p.reviewCandidate
				? {}
				: {
						proposal: {
							collectionId: p.collectionId,
							newCollectionName: p.newCollectionName,
							reason: p.reason,
							relevance: claim.settings.interests.length ? p.relevance : null,
						},
					}),
		})),
	};
}
function usageExceeded(
	response: Awaited<ReturnType<typeof callBookmarkAI>>,
	reservedNano: number,
	tokens: number
) {
	return (
		(response.chargedNano ?? 0) > reservedNano ||
		(response.inputTokens ?? 0) > tokens ||
		(response.outputTokens ?? 0) > AI_OUTPUT_LIMIT
	);
}
async function aiBatch(db: AppSupabaseClient, claim: Claim): Promise<Commit> {
	const kind = claim.job.kind as "classify" | "review" | "interests";
	if (!process.env.OPENROUTER_API_KEY?.trim())
		return { state: "paused", error: "서버 OPENROUTER_API_KEY 설정 후 작업을 재개해주세요." };
	let items = claim.items;
	const collections = claim.collections.map((c) => ({
		id: c.id,
		name: c.name,
		parentId: c.parent_id,
	}));
	const tags = kind === "interests" ? (await context(db)).tagCounts : undefined;
	let request = buildAIRequest(kind, {
		collections,
		confirmedInterests: claim.settings.interests,
		tagCounts: tags,
		bookmarks: items.map((b) => ({
			id: b.id,
			title: b.title,
			url: b.url,
			tags: b.tags,
			description: b.description,
			collectionId: b.collection_id,
			savedAt: b.saved_at,
			openButtonClicks: b.open_count,
			lastOpenButtonClick: b.opened_at,
			priorUse: "unknown",
			duplicateCount: b.duplicate_count ?? 0,
		})),
	});
	let tokens = await countAIInput(request);
	while (tokens > AI_INPUT_LIMIT && items.length > 1) {
		items = items.slice(0, Math.ceil(items.length / 2));
		request = buildAIRequest(kind, {
			collections,
			confirmedInterests: claim.settings.interests,
			bookmarks: items.map((b) => ({
				id: b.id,
				title: b.title,
				url: b.url,
				tags: b.tags,
				description: b.description,
				collectionId: b.collection_id,
				savedAt: b.saved_at,
				openButtonClicks: b.open_count,
				lastOpenButtonClick: b.opened_at,
				priorUse: "unknown",
				duplicateCount: b.duplicate_count ?? 0,
			})),
		});
		tokens = await countAIInput(request);
	}
	if (tokens > AI_INPUT_LIMIT)
		return {
			state: "paused",
			error: "컬렉션·메타데이터 입력이 너무 큽니다. 컬렉션 또는 선택 항목 범위를 줄여주세요.",
		};
	const reservationId = randomUUID();
	const reservedNano = reserveNano(AI_INPUT_LIMIT, AI_OUTPUT_LIMIT);
	const { data: reserved, error } = await db.rpc("bookmark_ai_reserve", {
		p_id: reservationId,
		p_job: claim.job.id,
		p_lease: claim.job.lease_token ?? "",
		p_tokens: AI_INPUT_LIMIT,
		p_amount: reservedNano,
		p_provider: "openrouter",
		p_model: request.model,
	});
	if (error) throw new Error("BUDGET_RESERVATION_FAILED");
	if (!reserved)
		return {
			state: "paused",
			error:
				"KST 이번 달 $1 예산이 부족합니다. 완료된 제안은 유지됩니다. 다음 달 직접 재개해주세요.",
		};
	try {
		const response = await callBookmarkAI(request);
		const settlement = {
			reservationId,
			reservationState: response.chargedNano === null ? "uncertain" : "settled",
			progress: {
				provider: "openrouter",
				model: request.model,
				inputTokens: response.inputTokens,
				usageUncertain: response.chargedNano === null,
			},
			chargedNano: response.chargedNano,
			outputTokens: response.outputTokens,
		} satisfies Commit;
		if (usageExceeded(response, reservedNano, AI_INPUT_LIMIT)) {
			return {
				...settlement,
				reservationState: "uncertain",
				progress: { ...settlement.progress, usageUncertain: true },
				state: "paused",
				error: "응답 사용량이 예약 산정을 벗어났습니다. 가격·사용량 확인이 필요합니다.",
			};
		}
		if (!response.output)
			return {
				...settlement,
				state: "failed",
				error: `AI 구조화 결과 검증 실패 (${response.outputError ?? "INVALID_OUTPUT"}). 같은 작업을 재개할 수 있습니다.`,
			};
		try {
			return { ...settlement, ...validatedAIResult(kind, response.output, claim, items) };
		} catch {
			return {
				...settlement,
				state: "failed",
				items: items.map((i) => ({
					id: i.id,
					state: "failed",
					error: "AI 결과의 대상·소속 검증 실패",
				})),
				error: "일부 AI 결과를 적용할 수 없습니다. 실패 항목을 재개해주세요.",
			};
		}
	} catch {
		// A sent request may have been billed even when its response was lost.
		return {
			reservationId,
			reservationState: "uncertain",
			state: "paused",
			error:
				"AI 응답을 확인하지 못했습니다. 청구가 불명확하여 예약액을 유지합니다. 직접 재개할 수 있습니다.",
		};
	}
}

async function recommendCollection(db: AppSupabaseClient, claim: Claim): Promise<Commit> {
	if (!process.env.OPENROUTER_API_KEY?.trim())
		return {
			state: "paused",
			error: "저장 추천 설정이 필요합니다. 수동으로 컬렉션을 선택해 저장할 수 있습니다.",
		};
	if (claim.collections.length >= 255)
		return {
			state: "paused",
			error: "Jev의 선택지 한도를 초과했습니다. 수동으로 컬렉션을 선택해주세요.",
		};
	const request = buildRecommendationRequest(
		claim.job.scope,
		claim.collections,
		claim.settings.interests
	);
	const reservation = recommendationReservation();
	const reservationId = randomUUID();
	const { data: reserved, error } = await db.rpc("bookmark_ai_reserve", {
		p_id: reservationId,
		p_job: claim.job.id,
		p_lease: claim.job.lease_token ?? "",
		p_tokens: reservation.tokens,
		p_amount: reservation.nano,
		p_provider: "openrouter",
		p_model: request.model,
	});
	if (error) throw new Error("BUDGET_RESERVATION_FAILED");
	if (!reserved)
		return {
			state: "paused",
			error: "KST 이번 달 $1 AI 예산이 부족합니다. 수동으로 컬렉션을 선택해 저장할 수 있습니다.",
		};
	try {
		const result = await callRecommendation(request, claim.collections);
		if ((result.chargedNano ?? 0) > reservation.nano)
			return {
				reservationId,
				reservationState: "uncertain",
				chargedNano: result.chargedNano,
				outputTokens: result.outputTokens,
				progress: { provider: "openrouter", usageUncertain: true },
				state: "paused",
				error:
					"OpenRouter 청구액이 예약 범위를 벗어나 중단했습니다. 가격·사용량 확인이 필요합니다.",
			};
		return {
			reservationId,
			reservationState: result.chargedNano === null ? "uncertain" : "settled",
			chargedNano: result.chargedNano,
			outputTokens: result.outputTokens,
			progress: {
				provider: "openrouter",
				model: "typesafe/jev-1.13",
				usageUncertain: result.chargedNano === null,
				inputTokens: result.inputTokens,
			},
			...(result.recommendation
				? { state: "succeeded", completed: 1, failed: 0, recommendation: result.recommendation }
				: {
						state: result.chargedNano === null ? "paused" : "failed",
						completed: 0,
						failed: 1,
						error:
							result.chargedNano === null
								? "추천 응답을 검증하지 못해 예약액을 유지합니다. 수동 저장은 가능합니다."
								: `추천 응답 검증 실패 (${result.outputError}). 알려진 사용량은 정산했습니다. 수동 저장은 가능합니다.`,
					}),
		};
	} catch {
		return {
			reservationId,
			reservationState: "uncertain",
			progress: { provider: "openrouter", model: "typesafe/jev-1.13", usageUncertain: true },
			state: "paused",
			completed: 0,
			error:
				"추천 응답을 확인하지 못해 예약액을 유지합니다. 작업 기록에서 재개하거나 수동으로 저장할 수 있습니다.",
		};
	}
}

async function processClaim(
	db: AppSupabaseClient,
	claim: Claim,
	getAccount: () => Promise<string>,
	token: string | undefined
): Promise<Commit> {
	let result: Commit;
	try {
		switch (claim.job.kind) {
			case "recommend":
				result = await recommendCollection(db, claim);
				break;
			case "import":
				result = await importPage(db, claim, await getAccount(), token);
				break;
			case "check":
				result = claim.items[0]
					? await processHealthClaim(db, {
							job: claim.job,
							item: { ...claim.items[0], work: claim.items[0].work ?? null },
							baseline: claim.items[0].baseline ?? null,
						})
					: {};
				break;
			case "metadata":
				result = await enrich(claim);
				break;
			default:
				result = await aiBatch(db, claim);
		}
	} catch {
		const retries = Number(claim.job.progress.errorAttempts ?? 0) + 1;
		result = {
			state: retries <= 3 ? "retry" : "failed",
			retryAfterSeconds: 60 * retries,
			progress: { errorAttempts: retries },
			error:
				claim.job.kind === "import"
					? "Raindrop 조회·검증 실패. 서버 토큰과 원본 자료를 확인하고 같은 작업을 재개해주세요."
					: "외부 조회·결과 검증 실패. 같은 작업을 재개해주세요.",
		};
	}
	if (!result.error) result.progress = { ...((result.progress as object) ?? {}), errorAttempts: 0 };
	return result;
}
export async function runBookmarkWorker(db: AppSupabaseClient) {
	const started = Date.now();
	let claimed = 0;
	let leaseRejected = 0;
	let account: Promise<string> | undefined;
	const token = process.env.RAINDROP_IMPORT_TOKEN?.trim();
	const getAccount = () =>
		(account ??= readRaindrop("user", token).then((value) =>
			String(z.object({ user: z.object({ _id: z.number().int() }) }).parse(value).user._id)
		));
	while (claimed < 20 && Date.now() - started < 20000) {
		const { data, error } = await db.rpc("bookmark_worker_claim");
		if (error) throw new Error("BOOKMARK_CLAIM_FAILED");
		if (!data) break;
		const claim = claimSchema.parse(data);
		const result = await processClaim(db, claim, getAccount, token);
		const { data: committed, error: commitError } = await db.rpc("bookmark_worker_commit", {
			p_job: claim.job.id,
			p_lease: claim.job.lease_token ?? "",
			p_result: result as Json,
		});
		if (commitError) throw new Error("BOOKMARK_COMMIT_FAILED");
		if (!committed) leaseRejected++;
		claimed++;
		if (claim.job.kind === "import") await new Promise((resolve) => setTimeout(resolve, 1200));
		// A single AI call can consume the route deadline; durable pending items remain for the next dispatch.
		if (["classify", "review", "interests", "recommend"].includes(claim.job.kind)) break;
		if (claim.job.kind === "check" && claim.items[0]?.work?.phase === "decision") break;
	}
	return { claimedCount: claimed, leaseRejectedCount: leaseRejected };
}
