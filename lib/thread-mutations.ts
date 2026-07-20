import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeThreadId, type ThreadTableName } from "./thread-query-cache";

const ALLOWED_TRANSITIONS = new Set([
	"new-threads:quick-save",
	"new-threads:trash",
	"quick-save:trash",
	"trash:new-threads",
]);

export async function moveThread(
	supabase: SupabaseClient,
	threadId: string | number,
	source: ThreadTableName,
	destination: ThreadTableName
) {
	const normalizedId = normalizeThreadId(threadId);

	if (!/^\d+$/.test(normalizedId)) {
		throw new Error("유효하지 않은 스레드 ID입니다.");
	}

	if (!ALLOWED_TRANSITIONS.has(`${source}:${destination}`)) {
		throw new Error(`지원하지 않는 스레드 이동입니다: ${source} -> ${destination}`);
	}

	const { data, error } = await supabase.rpc("move_thread", {
		p_thread_id: normalizedId,
		p_source: source,
		p_destination: destination,
	});

	if (error) {
		throw error;
	}

	return data as number | string;
}
