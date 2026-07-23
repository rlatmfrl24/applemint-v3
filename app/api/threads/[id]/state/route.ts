import { type NextRequest, NextResponse } from "next/server";
import { isThreadState, normalizeThreadId } from "@/lib/thread-list-contract";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

const statusForRpcError = (code: string | undefined) => {
	switch (code) {
		case "22023":
			return 400;
		case "P0002":
			return 404;
		case "40001":
			return 409;
		case "42501":
			return 403;
		default:
			return 500;
	}
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
	try {
		const id = normalizeThreadId((await context.params).id);
		if (!/^\d+$/.test(id) || BigInt(id) <= BigInt(0)) {
			return NextResponse.json({ error: "올바른 스레드 ID가 필요합니다." }, { status: 400 });
		}
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || !isThreadState(body.expectedState) || !isThreadState(body.destinationState)) {
			return NextResponse.json({ error: "올바른 상태 전이 값이 필요합니다." }, { status: 400 });
		}
		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}
		const { data, error } = await supabase.rpc("transition_thread_state", {
			p_thread_id: id,
			p_expected_state: body.expectedState,
			p_destination_state: body.destinationState,
		});
		if (error) {
			return NextResponse.json({ error: error.message }, { status: statusForRpcError(error.code) });
		}
		return NextResponse.json({ item: data });
	} catch (error) {
		console.error("스레드 상태 변경 실패", error);
		return NextResponse.json({ error: "스레드 상태를 변경하지 못했습니다." }, { status: 500 });
	}
}
