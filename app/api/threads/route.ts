import type { NextRequest } from "next/server";
import { handleThreadsListGet } from "@/app/api/thread-list";

export async function GET(request: NextRequest) {
	return handleThreadsListGet(request);
}
