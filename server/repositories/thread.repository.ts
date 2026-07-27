import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { type ThreadState, threadItemSchema } from "@/contracts/thread.schema";
import { unexpectedFailure } from "@/server/errors/domain-error";
import { mapPostgrestError } from "@/server/errors/error-mapper";
import type { RequestMetrics } from "@/server/observability/request-metrics";

const statsRowsSchema = z.array(
	z.object({
		key: z.string().min(1),
		label: z.string(),
		count: z.coerce.number().int().nonnegative(),
		total_count: z.coerce.number().int().nonnegative(),
	})
);

const movedCountSchema = z.coerce.number().int().nonnegative();

export interface ThreadPageCursor {
	stateChangedAt: string;
	id: string;
}

export class ThreadRepository {
	constructor(
		private readonly supabase: SupabaseClient,
		private readonly metrics?: RequestMetrics
	) {}

	private measure<T>(operation: string, run: () => Promise<T>) {
		return this.metrics?.measureRepository(operation, run) ?? run();
	}

	async list(
		state: ThreadState,
		input: {
			limit: number;
			cursor: ThreadPageCursor | null;
			filterType: string | null;
		}
	) {
		return this.measure("thread.list", async () => {
			const { data, error } = await this.supabase.rpc("list_threads_page", {
				p_state: state,
				p_limit: input.limit,
				p_cursor_state_changed_at: input.cursor?.stateChangedAt ?? null,
				p_cursor_id: input.cursor?.id ?? null,
				p_filter_type: input.filterType,
			});
			if (error) throw mapPostgrestError(error, "스레드 목록을 불러오지 못했습니다.");

			const parsed = z.array(threadItemSchema).safeParse(data ?? []);
			if (!parsed.success) {
				throw unexpectedFailure("스레드 목록 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}

	async stats(state: ThreadState, filterType: string | null) {
		return this.measure("thread.stats", async () => {
			const { data, error } = await this.supabase.rpc("get_thread_stats", {
				p_state: state,
				p_filter_type: filterType,
			});
			if (error) throw mapPostgrestError(error, "스레드 통계를 불러오지 못했습니다.");

			const parsed = statsRowsSchema.safeParse(data ?? []);
			if (!parsed.success) {
				throw unexpectedFailure("스레드 통계 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}

	async transition(input: {
		id: string;
		expectedState: ThreadState;
		destinationState: ThreadState;
	}) {
		return this.measure("thread.transition", async () => {
			const { data, error } = await this.supabase.rpc("transition_thread_state", {
				p_thread_id: input.id,
				p_expected_state: input.expectedState,
				p_destination_state: input.destinationState,
			});
			if (error) throw mapPostgrestError(error, "스레드 상태를 변경하지 못했습니다.");

			const parsed = threadItemSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("스레드 상태 변경 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}

	async bulkTrashInbox() {
		return this.measure("thread.bulkTrashInbox", async () => {
			const { data, error } = await this.supabase.rpc("bulk_move_inbox_to_trash");
			if (error) throw mapPostgrestError(error, "신규 글을 이동하지 못했습니다.");

			const parsed = movedCountSchema.safeParse(data ?? 0);
			if (!parsed.success) {
				throw unexpectedFailure("신규 글 일괄 이동 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}
}
