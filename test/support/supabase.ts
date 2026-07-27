import { vi } from "vitest";

interface RpcResult {
	data: unknown;
	error: unknown;
}

interface OwnerClientOptions {
	userId?: string | null;
	userError?: unknown;
	isOwner?: boolean | null;
	ownerError?: unknown;
	rpcResults?: RpcResult[];
}

export function createOwnerClientMock({
	userId = "owner",
	userError = null,
	isOwner = true,
	ownerError = null,
	rpcResults = [],
}: OwnerClientOptions = {}) {
	const rpc = vi.fn().mockResolvedValueOnce({ data: isOwner, error: ownerError });
	for (const result of rpcResults) {
		rpc.mockResolvedValueOnce(result);
	}

	return {
		client: {
			auth: {
				getClaims: vi.fn().mockResolvedValue({
					data: userId ? { claims: { sub: userId } } : null,
					error: userError,
				}),
				getUser: vi.fn().mockResolvedValue({
					data: { user: userId ? { id: userId } : null },
					error: userError,
				}),
			},
			rpc,
		},
		rpc,
	};
}
