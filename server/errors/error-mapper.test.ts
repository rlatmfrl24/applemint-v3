import { PostgrestError } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { mapPostgrestError } from "./error-mapper";

it("PostgREST HTTP 409를 재시도 없는 상태 충돌로 전달한다", () => {
	expect(
		mapPostgrestError(
			new PostgrestError({ code: "PT409", message: "bookmark changed", details: "", hint: "" }),
			"실패"
		)
	).toMatchObject({
		code: "StateConflict",
		message: "다른 화면에서 상태가 변경되었습니다. 최신 값을 확인해주세요.",
	});
});
