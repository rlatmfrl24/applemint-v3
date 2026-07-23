import type { NextRequest } from "next/server";
import { handleLegacyThreadListGet } from "@/app/api/thread-list";

export async function GET(request: NextRequest) {
	return handleLegacyThreadListGet(request, "quick-save");
}
