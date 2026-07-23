import type { NextRequest } from "next/server";
import { handleThreadStatsGet } from "@/app/api/thread-stats";

export async function GET(request: NextRequest) {
	return handleThreadStatsGet(request);
}
