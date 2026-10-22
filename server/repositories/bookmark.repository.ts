import { z } from "zod";
import {
	type BookmarkHealthStartResult,
	type BookmarkScope,
	bookmarkHealthSettingsSchema,
	bookmarkHealthStartResultSchema,
	bookmarkJobSchema,
	bookmarkLookupSchema,
	bookmarkRecommendationSchema,
	bookmarkSnapshotSchema,
} from "@/contracts/bookmark.schema";
import { bookmarkAIUsageSchema } from "@/contracts/bookmark-ai-usage.schema";
import { DomainError, unexpectedFailure } from "@/server/errors/domain-error";
import { mapPostgrestError } from "@/server/errors/error-mapper";
import type { RequestMetrics } from "@/server/observability/request-metrics";
import type { Json } from "@/types/database.types";
import type { AppSupabaseClient } from "@/types/supabase";

export class BookmarkRepository {
	constructor(
		private readonly supabase: AppSupabaseClient,
		private readonly metrics?: RequestMetrics
	) {}
	async sourceThread(id: string) {
		const { data, error } = await this.supabase
			.from("threads")
			.select("url,title")
			.filter("id", "eq", id)
			.maybeSingle();
		if (error) throw mapPostgrestError(error, "수집 글을 불러오지 못했습니다.");
		if (!data) throw new DomainError("NotFound", "수집 글을 찾을 수 없습니다.");
		return data;
	}
	async lookup(url: string) {
		const run = async () => {
			const { data, error } = await this.supabase
				.rpc("bookmark_lookup", { p_url: url })
				.maybeSingle();
			if (error) throw mapPostgrestError(error, "북마크 저장 여부를 확인하지 못했습니다.");
			const parsed = bookmarkLookupSchema.nullable().safeParse(data);
			if (!parsed.success)
				throw unexpectedFailure("북마크 조회 응답이 올바르지 않습니다.", parsed.error);
			return parsed.data;
		};
		return this.metrics?.measureRepository("bookmark.lookup", run) ?? run();
	}

	async snapshot(input: object) {
		const run = async () => {
			const { data, error } = await this.supabase.rpc("bookmark_snapshot", {
				p_filter: input as Json,
			});
			if (error) throw mapPostgrestError(error, "북마크를 불러오지 못했습니다.");
			const parsed = bookmarkSnapshotSchema.safeParse(data);
			if (!parsed.success)
				throw unexpectedFailure("북마크 응답이 올바르지 않습니다.", parsed.error);
			return parsed.data;
		};
		return this.metrics?.measureRepository("bookmark.snapshot", run) ?? run();
	}
	async healthSettings() {
		const { data, error } = await this.supabase.rpc("bookmark_health_settings");
		if (error) throw mapPostgrestError(error, "자동 검사 설정을 불러오지 못했습니다.");
		return bookmarkHealthSettingsSchema.parse(data);
	}
	async updateHealthSettings(input: { enabled: boolean; dailyLimit: number }) {
		const { data, error } = await this.supabase.rpc("bookmark_health_update_settings", {
			p_enabled: input.enabled,
			p_daily_limit: input.dailyLimit,
		});
		if (error) throw mapPostgrestError(error, "자동 검사 설정을 저장하지 못했습니다.");
		return bookmarkHealthSettingsSchema.parse(data);
	}
	startHealth(scope: BookmarkScope): Promise<BookmarkHealthStartResult> {
		return this.command("start", { ...scope, kind: "check" }, bookmarkHealthStartResultSchema);
	}
	async aiUsage() {
		const { data, error } = await this.supabase.rpc("bookmark_ai_usage");
		if (error) throw mapPostgrestError(error, "AI 사용량을 불러오지 못했습니다.");
		return bookmarkAIUsageSchema.parse(data);
	}
	async jobDetails(id: string, offset: number) {
		const { data, count, error } = await this.supabase
			.from("bookmark_job_items")
			.select("bookmark_id,state,error,available_at,phase:work->>phase,bookmarks(url,title)", {
				count: "exact",
			})
			.eq("job_id", id)
			.neq("state", "done")
			.order("state")
			.order("bookmark_id")
			.range(offset, offset + 49);
		if (error) throw mapPostgrestError(error, "작업 항목을 불러오지 못했습니다.");
		const items = z
			.array(
				z.object({
					bookmark_id: z.uuid(),
					state: z.enum(["pending", "waiting", "failed"]),
					error: z.string().nullable(),
					available_at: z.string(),
					phase: z.enum(["page", "media", "decision", "confirm", "done"]).nullable().default(null),
					bookmarks: z.object({ url: z.string(), title: z.string() }),
				})
			)
			.parse(data ?? []);
		return {
			items: items.map((item) => ({
				...item,
				waitingReason:
					item.state !== "waiting"
						? null
						: item.phase === "decision"
							? ("ai_budget" as const)
							: item.phase === "confirm"
								? ("confirmation" as const)
								: ["page", "media"].includes(item.phase ?? "")
									? ("host" as const)
									: ("retry" as const),
			})),
			total: count ?? 0,
		};
	}

	async jobs() {
		const [recent, imports] = await Promise.all([
			this.supabase
				.from("bookmark_jobs")
				.select("*")
				.order("created_at", { ascending: false })
				.limit(30),
			this.supabase.from("bookmark_jobs").select("*").eq("kind", "import"),
		]);
		for (const result of [recent, imports])
			if (result.error)
				throw mapPostgrestError(result.error, "북마크 작업 상태를 불러오지 못했습니다.");
		const jobs = new Map(
			[...(recent.data ?? []), ...(imports.data ?? [])].map((job) => [job.id, job])
		);
		return z
			.array(bookmarkJobSchema)
			.parse([...jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)));
	}
	async recommendation(id: string) {
		const { data, error } = await this.supabase
			.from("bookmark_jobs")
			.select("*")
			.eq("id", id)
			.eq("kind", "recommend")
			.maybeSingle();
		if (error) throw mapPostgrestError(error, "추천 작업을 불러오지 못했습니다.");
		if (!data) throw new DomainError("NotFound", "추천 작업을 찾을 수 없습니다.");
		const job = bookmarkJobSchema.parse(data);
		return {
			job,
			recommendation: bookmarkRecommendationSchema
				.nullable()
				.parse(job.progress.recommendation ?? null),
		};
	}

	async command<T>(action: string, input: object, schema: z.ZodType<T>) {
		const run = async () => {
			const { data, error } = await this.supabase.rpc("bookmark_command", {
				p_action: action,
				p_input: input as Json,
			});
			if (error) throw mapPostgrestError(error, "북마크 작업을 처리하지 못했습니다.");
			const parsed = schema.safeParse(data);
			if (!parsed.success)
				throw unexpectedFailure("북마크 작업 응답이 올바르지 않습니다.", parsed.error);
			return parsed.data;
		};
		return this.metrics?.measureRepository("bookmark.command", run) ?? run();
	}
}
