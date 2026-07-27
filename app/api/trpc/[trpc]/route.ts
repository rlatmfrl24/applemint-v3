import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { DomainError } from "@/server/errors/domain-error";
import { toTRPCError } from "@/server/errors/error-mapper";
import { withResponseMetrics } from "@/server/observability/http-request";
import { createTRPCContext, resolveRequestId } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/router";

export function getBatchSize(request: Request) {
	const path = new URL(request.url).pathname;
	const procedurePath = path.startsWith("/api/trpc/") ? path.slice("/api/trpc/".length) : "";
	return procedurePath ? procedurePath.split(",").length : 1;
}

const handler = async (request: Request) => {
	const requestId = resolveRequestId(request);
	const startedAt = performance.now();
	let context: Awaited<ReturnType<typeof createTRPCContext>> | undefined;

	const response = await fetchRequestHandler({
		endpoint: "/api/trpc",
		req: request,
		router: appRouter,
		async createContext() {
			try {
				context = await createTRPCContext(request, requestId);
				return context;
			} catch (error) {
				throw toTRPCError(
					new DomainError("UnexpectedFailure", "요청을 처리하지 못했습니다.", { requestId }, error)
				);
			}
		},
		onError({ ctx, error, path, type }) {
			const domainError = error.cause instanceof DomainError ? error.cause : null;
			const errorCode = domainError?.code ?? error.code;
			const outcome = [
				"BAD_REQUEST",
				"UNAUTHORIZED",
				"FORBIDDEN",
				"NOT_FOUND",
				"CONFLICT",
				"TOO_MANY_REQUESTS",
			].includes(error.code)
				? "rejected"
				: "failed";
			context?.metrics.recordFailure(errorCode, outcome);
			console.error({
				requestId: ctx?.requestId ?? domainError?.data.requestId ?? requestId,
				transport: "trpc",
				operation: path ?? "unknown",
				type,
				durationMs: Math.round(performance.now() - startedAt),
				outcome,
				errorCode,
			});
		},
	});

	return withResponseMetrics(response, requestId, (responseBytes) => {
		const metrics = context?.metrics.snapshot() ?? {
			authCallCount: 0,
			authDurationMs: 0,
			ownerCallCount: 0,
			ownerDurationMs: 0,
			repositoryCallCount: 0,
			repositoryDurationMs: 0,
			repositoryCalls: [],
			downstreamCallCount: 0,
			resultCount: 0,
			failureCount: response.ok ? 0 : 1,
			outcome: response.ok ? "succeeded" : "failed",
			errorCode: response.ok ? null : "context-initialization-failed",
		};
		console.info({
			requestId,
			transport: "trpc",
			event: "request",
			requestDurationMs: Math.round(performance.now() - startedAt),
			batchSize: getBatchSize(request),
			responseBytes,
			...metrics,
		});
	});
};

export { handler as GET, handler as POST };
