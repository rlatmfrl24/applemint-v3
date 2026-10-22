import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { BookmarkItem, BookmarkJob } from "@/contracts/bookmark.schema";
import {
	type BookmarkHealthEvidence,
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
import { HealthRequestDeferred } from "./safe-fetch";

export type HealthWork = {
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
	if (Buffer.byteLength(JSON.stringify(e)) > 7200) {
		e.content.title = e.content.title.slice(0, 300);
		e.content.excerpt = e.content.excerpt.slice(0, 200);
		e.media.items = e.media.items.map((item) => ({ ...item, label: item.label.slice(0, 80) }));
	}
	return bookmarkHealthEvidenceSchema.parse(e);
}
export async function processHealthClaim(
	db: AppSupabaseClient,
	claim: HealthClaim
): Promise<HealthCommit> {
	const { item, job } = claim;
	let receipt: HealthCommit["receipt"];
	const work: HealthWork = item.work
		? structuredClone(item.work)
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
	function commit(
		state: "pending" | "waiting" | "done" | "failed",
		availableAt?: string,
		error?: string
	): HealthCommit {
		const observation = work.observation;
		const check = observation
			? {
					...observation.reachability,
					checkedUrl: observation.input.url,
					evidence: compactEvidence(observation.evidence),
				}
			: undefined;
		return {
			receipt,
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
	const io: HealthIO = {
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
	function finish(): HealthCommit {
		const obs = work.observation;
		if (!obs) return commit("failed", undefined, "검사 근거가 없습니다.");
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
			return commit("waiting", work.confirmAfter);
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
		return commit("done");
	}
	try {
		if (!["page", "media", "decision", "confirm", "done"].includes(work.phase))
			return commit("failed", undefined, "검사 진행 정보가 올바르지 않습니다.");
		if (work.phase === "confirm") {
			if (work.confirmAfter && Date.parse(work.confirmAfter) > Date.now())
				return commit("waiting", work.confirmAfter);
			work.confirmationAttempts = 1;
			work.mediaCursor = 0;
			work.reservationId = null;
			work.evidenceKey = null;
			work.phase = "page";
		}
		if (work.phase === "page") {
			work.observation = await inspectBookmarkPage(
				{
					bookmarkId: item.id,
					url: item.url,
					title: item.title,
					version: item.expected_version,
					baseline: claim.baseline,
					decisionSample: Boolean(job.progress.decisionSample),
				},
				io
			);
			if (work.observation.reachability.status !== "healthy") return finish();
			work.phase = work.observation.mediaRefs.length ? "media" : "decision";
			return commit("pending");
		}
		const obs = work.observation;
		if (!obs || obs.input.url !== item.url || obs.input.version !== item.expected_version)
			return commit("failed", undefined, "검사 URL 또는 버전이 변경되었습니다.");
		if (work.phase === "media") {
			for (let n = 0; n < 2 && work.mediaCursor < obs.mediaRefs.length && !io.signal.aborted; n++) {
				const result = await probeHealthMedia(obs.mediaRefs[work.mediaCursor], io);
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
			return commit("pending");
		}
		if (work.phase !== "decision") return finish();
		const needed =
			obs.evidence.content.applicable &&
			(["unknown", "deleted_suspected", "changed_suspected"].includes(
				obs.evidence.content.status
			) ||
				obs.input.decisionSample);
		if (
			!needed ||
			obs.evidence.content.textLength === 0 ||
			obs.evidence.content.status === "restricted"
		)
			return finish();
		if (!process.env.OPENROUTER_API_KEY?.trim()) {
			obs.evidence.ai.state = "not_configured";
			return finish();
		}
		const request = buildHealthDecisionRequest(obs);
		const key = healthEvidenceKey(obs);
		const { data, error } = await db.rpc("bookmark_health_ai_reserve", {
			p_job: job.id,
			p_lease: job.lease_token ?? "",
			p_bookmark: item.id,
			p_reservation: randomUUID(),
			p_evidence_key: key,
		});
		if (error) throw new Error("HEALTH_AI_RESERVE_FAILED");
		const reserved = z
			.object({
				state: z.enum(["reserved", "cached", "uncertain", "budget_wait", "output_failed"]),
				reservationId: z.uuid().nullable(),
				decision: decisionSchema.nullable(),
				retryAt: z.string().nullable(),
			})
			.parse(data);
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
			return commit("waiting", reserved.retryAt ?? new Date(Date.now() + 86400000).toISOString());
		if (reserved.state === "uncertain" || reserved.state === "output_failed") {
			obs.evidence.ai.state = reserved.state === "uncertain" ? "uncertain" : "failed";
			return commit(
				"failed",
				undefined,
				"이전 AI 요청의 비용·결과를 확인해야 합니다. 자동 재호출하지 않습니다."
			);
		}
		let decision = reserved.decision;
		if (reserved.state === "reserved") {
			if (!reserved.reservationId) throw new Error("HEALTH_RESERVATION_ID_MISSING");
			try {
				const output = await callHealthDecision(request);
				const exceeded = (output.chargedNano ?? 0) > healthDecisionReservation().nano;
				receipt = {
					reservationId: reserved.reservationId,
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
				const { data: settled, error: settleError } = await db.rpc("bookmark_health_ai_settle", {
					p_reservation: reserved.reservationId,
					p_result: receipt.result,
				});
				if (settleError || !settled) throw new Error("HEALTH_AI_SETTLE_FAILED");
				if (exceeded) {
					obs.evidence.ai.state = "uncertain";
					return commit(
						"failed",
						undefined,
						"실제 비용이 예약액을 초과했습니다. 비용 확인이 필요합니다."
					);
				}
				if (output.outputError) {
					obs.evidence.ai.state = output.chargedNano === null ? "uncertain" : "failed";
					return commit("failed", undefined, "AI 출력 검증 실패. 알려진 비용은 보존했습니다.");
				}
				decision = output;
			} catch {
				await db.rpc("bookmark_health_ai_settle", {
					p_reservation: reserved.reservationId,
					p_result: receipt?.result ?? ({ state: "uncertain", chargedNano: null } as Json),
				});
				obs.evidence.ai.state = "uncertain";
				return commit(
					"failed",
					undefined,
					"AI 응답·정산을 확인하지 못해 예약을 유지합니다. 자동 재호출하지 않습니다."
				);
			}
		}
		if (!decision) {
			obs.evidence.ai.state = "failed";
			return commit("failed", undefined, "AI 판정 근거가 없습니다.");
		}
		obs.evidence.ai = {
			...obs.evidence.ai,
			state: "completed",
			choice: decision.choice,
			confidence: decision.confidence,
		};
		obs.evidence.content.status =
			decision.choice === "present"
				? "present"
				: decision.choice === "deleted"
					? "deleted_suspected"
					: decision.choice === "unrelated"
						? "changed_suspected"
						: decision.choice === "restricted"
							? "restricted"
							: "unknown";
		return finish();
	} catch (error) {
		if (error instanceof HealthRequestDeferred) return commit("waiting", error.retryAt);
		return commit(
			"failed",
			undefined,
			error instanceof Error ? error.message : "검사 실행에 실패했습니다."
		);
	}
}
