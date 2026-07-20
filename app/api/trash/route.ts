import type { NextRequest } from "next/server";
import { handleThreadListGet } from "@/app/api/thread-list";

export async function GET(request: NextRequest) {
	return handleThreadListGet(request, "trash");
}
