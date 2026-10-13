import { z } from "zod";
import { bookmarkSnapshotSchema } from "@/contracts/bookmark.schema";
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
	async jobDetails(id: string, offset: number) {
		const { data, count, error } = await this.supabase
			.from("bookmark_job_items")
			.select("bookmark_id,state,error,available_at,bookmarks(url,title)", { count: "exact" })
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
					bookmarks: z.object({ url: z.string(), title: z.string() }),
				})
			)
			.parse(data ?? []);
		return { items, total: count ?? 0 };
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
