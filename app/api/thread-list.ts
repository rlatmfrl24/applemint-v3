import type { SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { isThreadState } from "@/lib/thread-list-contract";
import type { ThreadItemType, ThreadState } from "@/lib/type-defs";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_BIGINT = BigInt("9223372036854775807");

export interface ThreadCursor {
	v: 1;
	state: ThreadState;
	stateChangedAt: string;
	id: string;
}

interface ThreadListParams {
	limit: number;
	cursor: ThreadCursor | null;
	filterType: string | null;
}

const getOptionalParam = (searchParams: URLSearchParams, key: string) => {
	const value = searchParams.get(key)?.trim();
	return value ? value : null;
};

const normalizeCursorFields = (timestamp: unknown, id: unknown) => {
	if (typeof timestamp !== "string" || typeof id !== "string" || !/^\d+$/.test(id)) {
		throw new Error("Invalid cursor fields.");
	}
	const normalizedId = BigInt(id);
	if (normalizedId <= BigInt(0) || normalizedId > MAX_BIGINT) throw new Error("Invalid cursor id.");
	return { timestamp: new Date(timestamp).toISOString(), id: normalizedId.toString() };
};

export function encodeThreadCursor(cursor: ThreadCursor) {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeThreadCursor(value: string, expectedState?: ThreadState): ThreadCursor {
	if (!value || value.length > MAX_CURSOR_LENGTH) throw new Error("Invalid thread cursor.");
	try {
		const parsed = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8")
		) as Partial<ThreadCursor>;
		if (parsed.v !== 1 || !isThreadState(parsed.state)) throw new Error("Invalid cursor version.");
		if (expectedState && parsed.state !== expectedState) throw new Error("Cursor state mismatch.");
		const normalized = normalizeCursorFields(parsed.stateChangedAt, parsed.id);
		return { v: 1, state: parsed.state, stateChangedAt: normalized.timestamp, id: normalized.id };
	} catch {
		throw new Error("Invalid thread cursor.");
	}
}

const parseLimit = (searchParams: URLSearchParams) => {
	const requested = Number.parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
	return Number.isNaN(requested) || requested <= 0 ? DEFAULT_LIMIT : Math.min(requested, MAX_LIMIT);
};

export function parseThreadListParams(request: NextRequest, state: ThreadState): ThreadListParams {
	const { searchParams } = new URL(request.url);
	const cursorValue = searchParams.get("cursor");
	return {
		limit: parseLimit(searchParams),
		cursor: cursorValue ? decodeThreadCursor(cursorValue, state) : null,
		filterType: getOptionalParam(searchParams, "filterType"),
	};
}

const loadThreadPage = (supabase: SupabaseClient, state: ThreadState, params: ThreadListParams) =>
	supabase.rpc("list_threads_page", {
		p_state: state,
		p_limit: params.limit,
		p_cursor_state_changed_at: params.cursor?.stateChangedAt ?? null,
		p_cursor_id: params.cursor?.id ?? null,
		p_filter_type: params.filterType,
	});

const ownerResponse = async (): Promise<
	{ response: NextResponse; supabase?: never } | { response?: never; supabase: SupabaseClient }
> => {
	const supabase = await createClient();
	const ownerAccess = await checkApplemintOwner(supabase);
	if (ownerAccess.kind !== "owner") {
		return {
			response: NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status }),
		};
	}
	return { supabase };
};

export async function handleThreadsListGet(request: NextRequest) {
	try {
		const stateValue = new URL(request.url).searchParams.get("state");
		if (!isThreadState(stateValue)) {
			return NextResponse.json({ error: "올바른 스레드 상태가 필요합니다." }, { status: 400 });
		}
		const access = await ownerResponse();
		if (access.response) return access.response;

		let params: ThreadListParams;
		try {
			params = parseThreadListParams(request, stateValue);
		} catch {
			return NextResponse.json({ error: "올바르지 않은 목록 커서입니다." }, { status: 400 });
		}

		const { data, error } = await loadThreadPage(access.supabase, stateValue, params);
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });
		const rows = (data ?? []) as ThreadItemType[];
		const hasMore = rows.length > params.limit;
		const items = hasMore ? rows.slice(0, params.limit) : rows;
		const lastItem = items.at(-1);
		const nextCursor =
			hasMore && lastItem
				? encodeThreadCursor({
						v: 1,
						state: stateValue,
						stateChangedAt: new Date(lastItem.state_changed_at).toISOString(),
						id: String(lastItem.id),
					})
				: null;
		return NextResponse.json({ items, nextCursor });
	} catch (error) {
		console.error("스레드 목록 조회 실패", error);
		return NextResponse.json({ error: "스레드 목록을 불러오지 못했습니다." }, { status: 500 });
	}
}
