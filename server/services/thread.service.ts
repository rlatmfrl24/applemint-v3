import type {
	ThreadListInput,
	ThreadPage,
	ThreadState,
	ThreadStats,
	ThreadTransitionInput,
} from "@/contracts/thread.schema";
import { getThreadTypeLabel } from "@/lib/thread-type";
import { DomainError } from "@/server/errors/domain-error";
import type { ThreadPageCursor, ThreadRepository } from "@/server/repositories/thread.repository";

const MAX_CURSOR_LENGTH = 512;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

interface ThreadCursor {
	v: 1;
	state: ThreadState;
	stateChangedAt: string;
	id: string;
}

export function encodeThreadCursor(cursor: ThreadCursor) {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeThreadCursor(value: string, expectedState: ThreadState): ThreadPageCursor {
	if (!value || value.length > MAX_CURSOR_LENGTH) {
		throw new DomainError("InvalidInput", "올바르지 않은 목록 커서입니다.");
	}

	try {
		const parsed = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8")
		) as Partial<ThreadCursor>;
		if (
			parsed.v !== 1 ||
			parsed.state !== expectedState ||
			typeof parsed.stateChangedAt !== "string" ||
			!Number.isFinite(Date.parse(parsed.stateChangedAt)) ||
			typeof parsed.id !== "string" ||
			!/^\d+$/u.test(parsed.id) ||
			BigInt(parsed.id) <= BigInt(0) ||
			BigInt(parsed.id) > MAX_POSTGRES_BIGINT
		) {
			throw new Error("Invalid cursor.");
		}
		return {
			stateChangedAt: new Date(parsed.stateChangedAt).toISOString(),
			id: BigInt(parsed.id).toString(),
		};
	} catch (error) {
		if (error instanceof DomainError) throw error;
		throw new DomainError("InvalidInput", "올바르지 않은 목록 커서입니다.", {}, error);
	}
}

export class ThreadService {
	constructor(private readonly repository: ThreadRepository) {}

	async list(input: ThreadListInput) {
		const limit = input.limit ?? 24;
		const rows = await this.repository.list(input.state, {
			limit,
			cursor: input.cursor ? decodeThreadCursor(input.cursor, input.state) : null,
			filterType: input.filterType ?? null,
		});
		const hasMore = rows.length > limit;
		const items = hasMore ? rows.slice(0, limit) : rows;
		const lastItem = items.at(-1);
		const nextCursor =
			hasMore && lastItem
				? encodeThreadCursor({
						v: 1,
						state: input.state,
						stateChangedAt: new Date(lastItem.state_changed_at).toISOString(),
						id: lastItem.id,
					})
				: null;

		return { items, nextCursor } satisfies ThreadPage;
	}

	async stats(input: { state: ThreadState; filterType?: string | null }) {
		const rows = await this.repository.stats(input.state, input.filterType ?? null);
		return {
			totalCount: rows.length > 0 ? rows[0].total_count : 0,
			counts: rows.map((row) => ({
				key: row.key,
				label: getThreadTypeLabel(row.key),
				count: row.count,
			})),
		} satisfies ThreadStats;
	}

	transition(input: ThreadTransitionInput) {
		return this.repository.transition(input);
	}

	async bulkTrashInbox() {
		return { movedCount: await this.repository.bulkTrashInbox() };
	}
}
