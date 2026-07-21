import { createClient } from "@supabase/supabase-js";
import { getE2ERuntime } from "./runtime";

export type E2EThreadTable = "new-threads" | "quick-save" | "trash";

interface SeedThreadOptions {
	prefix?: string;
	type?: string;
	tag?: string[];
	startAt?: Date;
}

function createAdminClient() {
	const runtime = getE2ERuntime();
	return createClient(runtime.supabaseUrl, runtime.serviceRoleKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});
}

export async function clearThreadTables() {
	const supabase = createAdminClient();
	for (const table of ["new-threads", "quick-save", "trash"] as const) {
		const { error } = await supabase.from(table).delete().gte("id", 0);
		if (error) {
			throw new Error(`${table} E2E 데이터 초기화 실패: ${error.message}`);
		}
	}
}

export async function countThreads(table: E2EThreadTable) {
	const supabase = createAdminClient();
	const { count, error } = await supabase.from(table).select("id", {
		count: "exact",
		head: true,
	});
	if (error) {
		throw new Error(`${table} E2E 데이터 집계 실패: ${error.message}`);
	}
	return count ?? 0;
}

export async function seedThreads(
	table: E2EThreadTable,
	count: number,
	options: SeedThreadOptions = {}
) {
	const supabase = createAdminClient();
	const prefix = options.prefix ?? table;
	const type = options.type ?? "arcalive";
	const startAt = options.startAt ?? new Date("2026-07-21T00:00:00.000Z");
	const rows = Array.from({ length: count }, (_, index) => {
		const capturedAt = new Date(startAt.getTime() - index * 1000).toISOString();
		return {
			type,
			url: `https://e2e.applemint.local/${prefix}/${index + 1}`,
			title: `${prefix} thread ${String(index + 1).padStart(2, "0")}`,
			description: `E2E ${table} fixture ${index + 1}`,
			host: "e2e.applemint.local",
			tag: options.tag ?? [type],
			created_at: capturedAt,
			captured_at: capturedAt,
		};
	});

	const { data, error } = await supabase.from(table).insert(rows).select("id,url,title");
	if (error) {
		throw new Error(`${table} E2E 데이터 생성 실패: ${error.message}`);
	}
	return data;
}
