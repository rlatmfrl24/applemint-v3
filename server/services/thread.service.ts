import type {
	ThreadItem,
	ThreadListInput,
	ThreadPage,
	ThreadState,
	ThreadStats,
	ThreadTransitionInput,
} from "@/contracts/thread.schema";
import { getSiteDisplayLabel } from "@/lib/community";
import { getThreadTypeLabel } from "@/lib/thread-type";
import { DomainError } from "@/server/errors/domain-error";
import type { ThreadPageCursor, ThreadStore } from "@/server/ports/thread.store";

const MAX_CURSOR_LENGTH = 512;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

interface ThreadCursor extends ThreadPageCursor {
	v: 1;
	state: ThreadState;
}

function normalizeThreadCursorTimestamp(value: string) {
	const iso = new Date(value).toISOString();
	const subMilliseconds = /\.\d{3}(\d{1,3})/u.exec(value)?.[1];
	return subMilliseconds && /[1-9]/u.test(subMilliseconds)
		? `${iso.slice(0, -1)}${subMilliseconds.padEnd(3, "0")}Z`
		: iso;
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
			stateChangedAt: normalizeThreadCursorTimestamp(parsed.stateChangedAt),
			id: BigInt(parsed.id).toString(),
		};
	} catch (error) {
		if (error instanceof DomainError) throw error;
		throw new DomainError("InvalidInput", "올바르지 않은 목록 커서입니다.", {}, error);
	}
}

function isAfter(candidate: ThreadPageCursor, head: ThreadPageCursor) {
	if (candidate.stateChangedAt === head.stateChangedAt) {
		return BigInt(candidate.id) > BigInt(head.id);
	}
	return candidate.stateChangedAt.slice(0, -1) > head.stateChangedAt.slice(0, -1);
}

function inclusiveUpperBound(head: ThreadPageCursor): ThreadPageCursor {
	const id = BigInt(head.id);
	// The repository cursor is exclusive, so start at the next possible position.
	if (id < MAX_POSTGRES_BIGINT) {
		return { ...head, id: String(id + BigInt(1)) };
	}
	const micros = (Number(head.stateChangedAt.slice(23, -1)) + 1) % 1000;
	const iso = new Date(Date.parse(head.stateChangedAt) + (micros === 0 ? 1 : 0)).toISOString();
	return { id: "1", stateChangedAt: `${iso.slice(0, -1)}${String(micros).padStart(3, "0")}Z` };
}

function threadPosition(thread: ThreadItem): ThreadPageCursor {
	return { id: thread.id, stateChangedAt: normalizeThreadCursorTimestamp(thread.state_changed_at) };
}

async function readInboxWindow(
	readPage: (cursor: ThreadPageCursor | null) => Promise<ThreadItem[]>,
	viewCursor: string | undefined
) {
	const head = viewCursor ? decodeThreadCursor(viewCursor, "inbox") : null;
	const latest = await readPage(null);
	const newest = latest[0] && threadPosition(latest[0]);
	const hasNew = Boolean(head && newest && isAfter(newest, head));
	// Fill the page from the accepted window so new rows cannot displace its tail.
	const rows = hasNew && head ? await readPage(inclusiveUpperBound(head)) : latest;
	const cursor =
		viewCursor ?? (newest ? encodeThreadCursor({ v: 1, state: "inbox", ...newest }) : null);
	return { rows, inboxWindow: { cursor, hasNew } };
}

export class ThreadService {
	constructor(private readonly store: ThreadStore) {}

	async list(input: ThreadListInput) {
		const limit = input.limit ?? 24;
		const readPage = (cursor: ThreadPageCursor | null) =>
			this.store.list(input.state, {
				limit,
				cursor,
				filterType: input.filterType ?? null,
				filterSite: input.filterSite ?? null,
			});
		const cursor = input.cursor ? decodeThreadCursor(input.cursor, input.state) : null;
		const { rows, inboxWindow } =
			input.state === "inbox" && cursor === null
				? await readInboxWindow(readPage, input.inboxViewCursor)
				: { rows: await readPage(cursor), inboxWindow: undefined };
		const hasMore = rows.length > limit;
		const items = hasMore ? rows.slice(0, limit) : rows;
		const lastItem = items.at(-1);
		const nextCursor =
			hasMore && lastItem
				? encodeThreadCursor({
						v: 1,
						state: input.state,
						...threadPosition(lastItem),
					})
				: null;

		return { items, nextCursor, ...(inboxWindow && { inboxWindow }) } satisfies ThreadPage;
	}

	async stats(input: { state: ThreadState; filterType?: string | null }) {
		const snapshot = await this.store.stats(input.state, input.filterType ?? null);
		const rows = snapshot.rows;
		const siteRows = snapshot.sites;
		const promotedNormalCount = siteRows.reduce((total, row) => total + row.count, 0);
		const rawTotalCount = rows.length > 0 ? rows[0].total_count : 0;
		return {
			totalCount:
				input.state === "inbox" && input.filterType === "normal"
					? Math.max(0, rawTotalCount - promotedNormalCount)
					: rawTotalCount,
			counts: rows.map((row) => ({
				key: row.key,
				label: getThreadTypeLabel(row.key),
				count:
					input.state === "inbox" && row.key === "normal"
						? Math.max(0, row.count - promotedNormalCount)
						: row.count,
			})),
			siteCounts: input.filterType
				? []
				: siteRows.map((row) => ({
						siteKey: row.site_key,
						label: getSiteDisplayLabel(row.site_key),
						count: row.count,
					})),
		} satisfies ThreadStats;
	}

	transition(input: ThreadTransitionInput) {
		return this.store.transition(input);
	}

	async bulkTrashInbox() {
		return { movedCount: await this.store.bulkTrashInbox() };
	}
}
