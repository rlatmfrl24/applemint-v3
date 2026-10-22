import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { BookmarkItem, BookmarkJob } from "@/contracts/bookmark.schema";
import {
	type BookmarkHealthEvidence,
	bookmarkHealthEvidenceBytes,
	bookmarkHealthEvidenceSchema,
} from "@/contracts/bookmark-health.schema";
import type { Json } from "@/types/database.types";
import type { AppSupabaseClient } from "@/types/supabase";
import {
	type HealthBaseline,
	type HealthObservation,
	inspectBookmarkPage,
	type LinkResult,
} from "./health";
import {
	buildHealthDecisionRequest,
	callHealthDecision,
	healthDecisionReservation,
	healthEvidenceKey,
} from "./health-decision";
import { type HealthIO, probeHealthMedia } from "./health-media";
import { type HealthFetchContinuation, HealthRequestDeferred } from "./safe-fetch";

export type HealthWork = {
	requestContinuation?: HealthFetchContinuation;
	phase: "page" | "media" | "decision" | "confirm" | "done";
	observation: HealthObservation | null;
	mediaCursor: number;
	reservationId: string | null;
	evidenceKey: string | null;
	confirmAfter: string | null;
	confirmationFingerprint: string | null;
	confirmationFirstObservedAt: string | null;
	confirmationAttempts: 0 | 1;
};
export type HealthClaim = {
	job: BookmarkJob;
	item: Pick<BookmarkItem, "id" | "url" | "title" | "version"> & {
		expected_version: number;
		work: HealthWork | null;
	};
	baseline: HealthBaseline | null;
};
export type HealthCommit = {
	receipt?: { reservationId: string; result: Json };
	items: Array<{
		id: string;
		version: number;
		state: "pending" | "waiting" | "done" | "failed";
		work: HealthWork | null;
		check?: LinkResult & { checkedUrl: string; evidence: BookmarkHealthEvidence };
		availableAt?: string;
		error?: string;
	}>;
	progress?: Record<string, unknown>;
};
const decisionSchema = z.object({
	choice: z.enum(["present", "deleted", "restricted", "unrelated", "unknown"]).nullable(),
	basis: z.string().nullable(),
	confidence: z.number().min(0).max(1).nullable(),
});
function compactEvidence(e: BookmarkHealthEvidence) {
	if (bookmarkHealthEvidenceBytes(e) > 8192) {
		e.content.title = e.content.title.slice(0, 300);
		e.content.excerpt = e.content.excerpt.slice(0, 200);
		for (const width of [80, 40, 20, 0]) {
			if (bookmarkHealthEvidenceBytes(e) <= 8192) break;
			e.media.items = e.media.items.map((item) => ({ ...item, label: item.label.slice(0, width) }));
		}
	}
	return bookmarkHealthEvidenceSchema.parse(e);
}

function needsHealthDecision(obs: HealthObservation) {
	return (
		obs.evidence.content.applicable &&
		obs.evidence.content.textLength > 0 &&
		obs.evidence.content.status !== "restricted" &&
		(["unknown", "deleted_suspected", "changed_suspected"].includes(obs.evidence.content.status) ||
			obs.input.decisionSample)
	);
}

function healthIO(db: AppSupabaseClient): HealthIO {
	return {
		signal: AbortSignal.timeout(20000),
		beforeRequest: async (url) => {
			const { data, error } = await db.rpc("bookmark_health_host_claim", { p_host: url.hostname });
			if (error) throw new Error("HEALTH_HOST_CLAIM_FAILED");
			const permit = z.object({ token: z.uuid().nullable(), retryAt: z.string() }).parse(data);
			if (!permit.token) throw new HealthRequestDeferred(permit.retryAt);
			return async (retryAt) => {
				const { error: releaseError } = await db.rpc("bookmark_health_host_release", {
					p_host: url.hostname,
					p_token: permit.token ?? "",
					p_retry_at: retryAt ?? new Date(Date.now() + 2000).toISOString(),
				});
				if (releaseError) throw new Error("HEALTH_HOST_RELEASE_FAILED");
			};
		},
	};
}

class HealthRun {
	private readonly work: HealthWork;
	private readonly io: HealthIO;
	private receipt: HealthCommit["receipt"];
	constructor(
		private readonly db: AppSupabaseClient,
		private readonly claim: HealthClaim
	) {
		this.work = claim.item.work
			? structuredClone(claim.item.work)
			: {
					phase: "page",
					observation: null,
					mediaCursor: 0,
					reservationId: null,
					evidenceKey: null,
					confirmAfter: null,
					confirmationFingerprint: null,
					confirmationFirstObservedAt: null,
					confirmationAttempts: 0,
				};
		this.io = { ...healthIO(db), continuation: this.work.requestContinuation };
	}
	commit(
		state: "pending" | "waiting" | "done" | "failed",
		availableAt?: string,
		error?: string
	): HealthCommit {
		const work = this.work;
		const { item } = this.claim;

		const observation = work.observation;
		const check = observation
			? {
					...observation.reachability,
					checkedUrl: observation.input.url,
					evidence: compactEvidence(structuredClone(observation.evidence)),
				}
			: undefined;
		return {
			receipt: this.receipt,
			items: [
				{
					id: item.id,
					version: item.expected_version,
					state,
					work: state === "done" ? { ...work, phase: "done", observation: null } : work,
					check,
					availableAt,
					error,
				},
			],
		};
	}
	finish(): HealthCommit {
		const work = this.work;

		const obs = work.observation;
		if (!obs) return this.commit("failed", undefined, "검사 근거가 없습니다.");
		const e = obs.evidence;
		const suspect =
			obs.reachability.status === "dead" ||
			["deleted_suspected", "changed_suspected"].includes(e.content.status) ||
			["partial", "missing_suspected"].includes(e.media.status);
		const fingerprint = createHash("sha256")
			.update(
				JSON.stringify([
					obs.input.url,
					obs.reachability.status,
					e.content.status,
					e.content.textHash,
					e.media.status,
					e.media.items.map((m) => [m.urlHash, m.state]),
				])
			)
			.digest("hex");
		if (suspect && work.confirmationAttempts === 0) {
			work.phase = "confirm";
			work.confirmationFingerprint = fingerprint;
			work.confirmationFirstObservedAt = e.observedAt;
			work.confirmAfter = new Date(
				Date.now() + (obs.reachability.status === "dead" ? 60000 : 86400000)
			).toISOString();
			e.confirmation = "pending";
			e.confirmationEvidence = {
				firstObservedAt: e.observedAt,
				firstFingerprint: fingerprint,
				confirmedAt: null,
			};
			return this.commit("waiting", work.confirmAfter);
		}
		if (work.confirmationAttempts === 1) {
			e.confirmationEvidence = {
				firstObservedAt: work.confirmationFirstObservedAt,
				firstFingerprint: work.confirmationFingerprint,
				confirmedAt: e.observedAt,
			};
			if (suspect && fingerprint === work.confirmationFingerprint) e.confirmation = "repeated";
			else if (suspect) {
				e.content.status = "unknown";
				if (["partial", "missing_suspected"].includes(e.media.status)) e.media.status = "unknown";
				e.reasonCodes.push("CONFIRMATION_INCONCLUSIVE");
			}
		}
		return this.commit("done");
	}
	async decide(): Promise<HealthCommit> {
		const work = this.work;
		const obs = work.observation;
		if (!obs) return this.commit("failed", undefined, "검사 근거가 없습니다.");
		if (!needsHealthDecision(obs)) return this.finish();
		if (!process.env.OPENROUTER_API_KEY?.trim()) {
			obs.evidence.ai.state = "not_configured";
			return this.finish();
		}
		const request = buildHealthDecisionRequest(obs);
		const key = healthEvidenceKey(obs);
		const reserved = await this.reserve(key);
		work.evidenceKey = key;
		work.reservationId = reserved.reservationId;
		obs.evidence.ai = {
			state: "pending",
			model: "typesafe/jev-1.13",
			choice: null,
			confidence: null,
			reservationId: reserved.reservationId,
		};
		if (reserved.state === "budget_wait")
			return this.commit(
				"waiting",
				reserved.retryAt ?? new Date(Date.now() + 86400000).toISOString()
			);
		if (reserved.state === "uncertain" || reserved.state === "output_failed") {
			obs.evidence.ai.state = reserved.state === "uncertain" ? "uncertain" : "failed";
			return this.commit(
				"failed",
				undefined,
				"이전 AI 요청의 비용·결과를 확인해야 합니다. 자동 재호출하지 않습니다."
			);
		}
		const decision =
			reserved.state === "reserved"
				? await this.requestDecision(request, reserved.reservationId)
				: reserved.decision;
		if (decision && "items" in decision) return decision;
		if (!decision) {
			obs.evidence.ai.state = "failed";
			return this.commit("failed", undefined, "AI 판정 근거가 없습니다.");
		}
		obs.evidence.ai = {
			...obs.evidence.ai,
			state: "completed",
			choice: decision.choice,
			confidence: decision.confidence,
		};
		const statuses = {
			present: "present",
			deleted: "deleted_suspected",
			unrelated: "changed_suspected",
			restricted: "restricted",
			unknown: "unknown",
		} as const;
		obs.evidence.content.status = statuses[decision.choice ?? "unknown"];
		return this.finish();
	}

	async reserve(key: string) {
		const { item, job } = this.claim;
		const { data, error } = await this.db.rpc("bookmark_health_ai_reserve", {
			p_job: job.id,
			p_lease: job.lease_token ?? "",
			p_bookmark: item.id,
			p_reservation: randomUUID(),
			p_evidence_key: key,
		});
		if (error) throw new Error("HEALTH_AI_RESERVE_FAILED");
		return z
			.object({
				state: z.enum(["reserved", "cached", "uncertain", "budget_wait", "output_failed"]),
				reservationId: z.uuid().nullable(),
				decision: decisionSchema.nullable(),
				retryAt: z.string().nullable(),
			})
			.parse(data);
	}

	async requestDecision(
		request: ReturnType<typeof buildHealthDecisionRequest>,
		reservationId: string | null
	): Promise<Awaited<ReturnType<typeof callHealthDecision>> | HealthCommit> {
		if (!reservationId) throw new Error("HEALTH_RESERVATION_ID_MISSING");
		const obs = this.work.observation;
		if (!obs) throw new Error("HEALTH_OBSERVATION_MISSING");

		try {
			const output = await callHealthDecision(request);
			const exceeded = (output.chargedNano ?? 0) > healthDecisionReservation().nano;
			this.receipt = {
				reservationId: reservationId,
				result: {
					state: output.chargedNano === null || exceeded ? "uncertain" : "settled",
					chargedNano: output.chargedNano,
					inputTokens: output.inputTokens,
					outputTokens: output.outputTokens,
					outputError: output.outputError,
					decision:
						output.outputError || exceeded
							? null
							: { choice: output.choice, basis: output.basis, confidence: output.confidence },
				} as Json,
			};
			const { data: settled, error: settleError } = await this.db.rpc("bookmark_health_ai_settle", {
				p_reservation: reservationId,
				p_result: this.receipt.result,
			});
			if (settleError || !settled) throw new Error("HEALTH_AI_SETTLE_FAILED");
			if (exceeded) {
				obs.evidence.ai.state = "uncertain";
				return this.commit(
					"failed",
					undefined,
					"실제 비용이 예약액을 초과했습니다. 비용 확인이 필요합니다."
				);
			}
			if (output.outputError) {
				obs.evidence.ai.state = output.chargedNano === null ? "uncertain" : "failed";
				return this.commit("failed", undefined, "AI 출력 검증 실패. 알려진 비용은 보존했습니다.");
			}
			return output;
		} catch {
			await this.db.rpc("bookmark_health_ai_settle", {
				p_reservation: reservationId,
				p_result: this.receipt?.result ?? ({ state: "uncertain", chargedNano: null } as Json),
			});
			obs.evidence.ai.state = "uncertain";
			return this.commit(
				"failed",
				undefined,
				"AI 응답·정산을 확인하지 못해 예약을 유지합니다. 자동 재호출하지 않습니다."
			);
		}
	}

	async page(): Promise<HealthCommit> {
		const work = this.work;
		const { item, job } = this.claim;

		work.observation = await inspectBookmarkPage(
			{
				bookmarkId: item.id,
				url: item.url,
				title: item.title,
				version: item.expected_version,
				baseline: this.claim.baseline,
				decisionSample:
					Array.isArray(job.scope.decisionSampleIds) &&
					job.scope.decisionSampleIds.includes(item.id),
			},
			{ ...this.io }
		);
		delete work.requestContinuation;
		delete this.io.continuation;
		if (work.observation.reachability.status !== "healthy") return this.finish();
		work.phase = work.observation.mediaRefs.length ? "media" : "decision";
		return this.commit("pending");
	}

	async media(obs: HealthObservation): Promise<HealthCommit> {
		const work = this.work;
		const io = this.io;

		for (let n = 0; n < 2 && work.mediaCursor < obs.mediaRefs.length && !io.signal.aborted; n++) {
			const result = await probeHealthMedia(obs.mediaRefs[work.mediaCursor], io);
			delete work.requestContinuation;
			delete io.continuation;
			obs.evidence.media.items.push(result);
			obs.evidence.media.checked++;
			obs.evidence.media[result.state]++;
			work.mediaCursor++;
		}
		const media = obs.evidence.media;
		media.status =
			media.missing > 0
				? media.reachable > 0
					? "partial"
					: "missing_suspected"
				: media.restricted + media.unknown > 0
					? "unknown"
					: media.checked === media.discovered && obs.evidence.coverage === "complete"
						? "present"
						: "unknown";
		if (work.mediaCursor >= obs.mediaRefs.length) work.phase = "decision";
		return this.commit("pending");
	}

	async run(): Promise<HealthCommit> {
		const work = this.work;
		const { item } = this.claim;
		try {
			if (!["page", "media", "decision", "confirm", "done"].includes(work.phase))
				return this.commit("failed", undefined, "검사 진행 정보가 올바르지 않습니다.");
			if (work.phase === "confirm") {
				if (work.confirmAfter && Date.parse(work.confirmAfter) > Date.now())
					return this.commit("waiting", work.confirmAfter);
				work.confirmationAttempts = 1;
				work.mediaCursor = 0;
				work.reservationId = null;
				work.evidenceKey = null;
				work.phase = "page";
			}
			if (work.phase === "page") return await this.page();
			const obs = work.observation;
			if (!obs || obs.input.url !== item.url || obs.input.version !== item.expected_version)
				return this.commit("failed", undefined, "검사 URL 또는 버전이 변경되었습니다.");
			if (work.phase === "media") return await this.media(obs);
			if (work.phase !== "decision") return this.finish();
			return await this.decide();
		} catch (error) {
			if (error instanceof HealthRequestDeferred) {
				work.requestContinuation = error.continuation;
				return this.commit("waiting", error.retryAt);
			}
			return this.commit(
				"failed",
				undefined,
				error instanceof Error ? error.message : "검사 실행에 실패했습니다."
			);
		}
	}
}
export async function processHealthClaim(
	db: AppSupabaseClient,
	claim: HealthClaim
): Promise<HealthCommit> {
	return new HealthRun(db, claim).run();
}
