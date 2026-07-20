import type { SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import type { ThreadTableName } from "@/lib/thread-list-contract";
import type { ThreadItemType } from "@/lib/type-defs";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_BIGINT = BigInt("9223372036854775807");

interface ThreadCursor {
	createdAt: string;
	id: string;
}

interface ThreadListParams {
	limit: number;
	cursor: ThreadCursor | null;
	filterType: string | null;
	issuelinkCategory: string | null;
}

const getOptionalParam = (searchParams: URLSearchParams, key: string) => {
	const value = searchParams.get(key)?.trim();
	return value ? value : null;
};

export function encodeThreadCursor(cursor: ThreadCursor) {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeThreadCursor(value: string): ThreadCursor {
	if (!value || value.length > MAX_CURSOR_LENGTH) {
		throw new Error("Invalid thread cursor.");
	}

	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") {
			throw new Error("Invalid cursor payload.");
		}

		const { createdAt, id } = parsed as Partial<ThreadCursor>;
		if (typeof createdAt !== "string" || typeof id !== "string" || !/^\d+$/.test(id)) {
			throw new Error("Invalid cursor fields.");
		}

		const normalizedCreatedAt = new Date(createdAt).toISOString();
		const normalizedId = BigInt(id);
		if (normalizedId <= BigInt(0) || normalizedId > MAX_BIGINT) {
			throw new Error("Invalid cursor id.");
		}

		return {
			createdAt: normalizedCreatedAt,
			id: normalizedId.toString(),
		};
	} catch {
		throw new Error("Invalid thread cursor.");
	}
}

export function parseThreadListParams(request: NextRequest): ThreadListParams {
	const { searchParams } = new URL(request.url);
	const requestedLimit = Number.parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
	const limit =
		Number.isNaN(requestedLimit) || requestedLimit <= 0
			? DEFAULT_LIMIT
			: Math.min(requestedLimit, MAX_LIMIT);
	const cursorValue = searchParams.get("cursor");

	return {
		limit,
		cursor: cursorValue ? decodeThreadCursor(cursorValue) : null,
		filterType: getOptionalParam(searchParams, "filterType"),
		issuelinkCategory: getOptionalParam(searchParams, "issuelinkCategory"),
	};
}

async function loadThreadPage(
	supabase: SupabaseClient,
	table: ThreadTableName,
	params: ThreadListParams
) {
	return supabase.rpc("list_thread_page", {
		p_list: table,
		p_limit: params.limit,
		p_cursor_created_at: params.cursor?.createdAt ?? null,
		p_cursor_id: params.cursor?.id ?? null,
		p_filter_type: params.filterType,
		p_issuelink_category: params.issuelinkCategory,
	});
}

export async function handleThreadListGet(request: NextRequest, table: ThreadTableName) {
	try {
		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}

		let params: ThreadListParams;
		try {
			params = parseThreadListParams(request);
		} catch {
			return NextResponse.json({ error: "올바르지 않은 목록 커서입니다." }, { status: 400 });
		}

		const { data, error } = await loadThreadPage(supabase, table, params);
		if (error) {
			return NextResponse.json({ error: error.message }, { status: 500 });
		}

		const rows = (data ?? []) as ThreadItemType[];
		const hasMore = rows.length > params.limit;
		const items = hasMore ? rows.slice(0, params.limit) : rows;
		const lastItem = items.at(-1);
		let nextCursor: string | null = null;

		if (hasMore && lastItem) {
			if (!lastItem.created_at) {
				return NextResponse.json({ error: "목록 커서를 생성할 수 없습니다." }, { status: 500 });
			}

			nextCursor = encodeThreadCursor({
				createdAt: new Date(lastItem.created_at).toISOString(),
				id: String(lastItem.id),
			});
		}

		return NextResponse.json({ items, nextCursor });
	} catch (error) {
		console.error(`${table} 목록 조회 실패`, error);
		return NextResponse.json({ error: "스레드 목록을 불러오지 못했습니다." }, { status: 500 });
	}
}
