import { initTRPC, TRPCError } from "@trpc/server";
import { publicErrorDataSchema } from "@/contracts/error.schema";
import { DomainError } from "@/server/errors/domain-error";
import { toTRPCError } from "@/server/errors/error-mapper";
import type { TRPCContext } from "./context";

const t = initTRPC.context<TRPCContext>().create({
	errorFormatter({ shape, error, ctx }) {
		const domainError = error.cause instanceof DomainError ? error.cause : null;
		const publicData = publicErrorDataSchema.parse({
			requestId: ctx?.requestId ?? domainError?.data.requestId ?? "unknown",
			latestSettings: domainError?.data.latestSettings ?? null,
			retryAfterSeconds: domainError?.data.retryAfterSeconds ?? null,
			reasonCode: domainError?.data.reasonCode ?? null,
		});
		return {
			...shape,
			data: {
				...shape.data,
				...publicData,
			},
		};
	},
});

const errorBoundaryMiddleware = t.middleware(async ({ next, signal }) => {
	try {
		const result = await next();
		if (!result.ok) throw result.error;
		return result;
	} catch (error) {
		// tRPC wraps request body read failures as BAD_REQUEST, including socket aborts.
		if (
			signal?.aborted &&
			error instanceof TRPCError &&
			error.code === "BAD_REQUEST" &&
			error.cause &&
			(error.cause.name === "AbortError" ||
				("code" in error.cause && error.cause.code === "ECONNRESET"))
		) {
			throw new TRPCError({
				code: "CLIENT_CLOSED_REQUEST",
				message: "클라이언트가 요청을 취소했습니다.",
				cause: error.cause,
			});
		}
		throw toTRPCError(error);
	}
});

const observabilityMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
	const startedAt = performance.now();
	const result = await next();
	if (result.ok) {
		const resultCount = ctx.metrics.recordResult(result.data);
		console.info({
			requestId: ctx.requestId,
			transport: "trpc",
			operation: path,
			type,
			durationMs: Math.round(performance.now() - startedAt),
			resultCount,
			outcome: "succeeded",
		});
	}
	return result;
});

const baseProcedure = t.procedure.use(errorBoundaryMiddleware).use(observabilityMiddleware);

export const authenticatedReadProcedure = baseProcedure.use(async ({ ctx, next }) => {
	const access = await ctx.getAuthenticatedAccess();
	switch (access.kind) {
		case "authenticated":
			return next({ ctx });
		case "unauthenticated":
			throw new DomainError("Unauthenticated", access.message);
		case "unavailable":
			throw new DomainError("ConfigurationUnavailable", access.message, {
				reasonCode: "auth-validation-unavailable",
			});
	}
});

export const ownerProcedure = baseProcedure.use(async ({ ctx, next }) => {
	const access = await ctx.getOwnerAccess();
	switch (access.kind) {
		case "owner":
			return next({ ctx });
		case "unauthenticated":
			throw new DomainError("Unauthenticated", access.message);
		case "forbidden":
			throw new DomainError("Forbidden", access.message);
		case "unavailable":
			throw new DomainError("ConfigurationUnavailable", access.message, {
				reasonCode: "owner-access-unavailable",
			});
	}
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
