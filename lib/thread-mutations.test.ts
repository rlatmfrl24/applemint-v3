import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { moveThread } from "./thread-mutations";

describe("moveThread", () => {
	it("허용된 전이를 RPC로 전달한다", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: 42, error: null });
		const supabase = { rpc } as unknown as SupabaseClient;

		await expect(moveThread(supabase, " 12 ", "new-threads", "trash")).resolves.toBe(42);
		expect(rpc).toHaveBeenCalledWith("move_thread", {
			p_thread_id: "12",
			p_source: "new-threads",
			p_destination: "trash",
		});
	});

	it("허용되지 않은 전이는 RPC 호출 전에 거부한다", async () => {
		const rpc = vi.fn();
		const supabase = { rpc } as unknown as SupabaseClient;

		await expect(moveThread(supabase, 1, "trash", "quick-save")).rejects.toThrow(
			"지원하지 않는 스레드 이동"
		);
		expect(rpc).not.toHaveBeenCalled();
	});

	it("RPC 오류를 호출자에게 전달한다", async () => {
		const rpcError = new Error("insert failed");
		const supabase = {
			rpc: vi.fn().mockResolvedValue({ data: null, error: rpcError }),
		} as unknown as SupabaseClient;

		await expect(moveThread(supabase, 1, "quick-save", "trash")).rejects.toBe(rpcError);
	});
});
