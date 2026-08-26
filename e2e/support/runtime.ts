import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface E2ERuntime {
	baseUrl: string;
	supabaseUrl: string;
	publishableKey: string;
	secretKey: string;
	internalSecret: string;
	databaseContainer: string;
	ownerEmail: string;
	ownerPassword: string;
}

let cachedRuntime: E2ERuntime | undefined;

export function getE2ERuntime(): E2ERuntime {
	if (!cachedRuntime) {
		cachedRuntime = JSON.parse(
			readFileSync(resolve("playwright/.auth/runtime.json"), "utf8")
		) as E2ERuntime;
	}
	return cachedRuntime;
}
