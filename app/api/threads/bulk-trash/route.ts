import { NextResponse } from "next/server";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

export async function POST() {
	try {
		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}
		const { data, error } = await supabase.rpc("bulk_move_inbox_to_trash");
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });
		return NextResponse.json({ movedCount: Number(data ?? 0) });
	} catch (error) {
		console.error("신규 스레드 일괄 이동 실패", error);
		return NextResponse.json({ error: "신규 글을 이동하지 못했습니다." }, { status: 500 });
	}
}
