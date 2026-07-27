import { resolveRequestId } from "@/lib/request-id";
import { RequestMetrics } from "./request-metrics";

export function withResponseMetrics(
	response: Response,
	requestId: string,
	onComplete: (responseBytes: number) => void
) {
	const headers = new Headers(response.headers);
	headers.set("x-request-id", requestId);
	if (!response.body) {
		onComplete(0);
		return new Response(null, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}

	let responseBytes = 0;
	const body = response.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				responseBytes += chunk.byteLength;
				controller.enqueue(chunk);
			},
			flush() {
				onComplete(responseBytes);
			},
		})
	);
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export interface ObservedRequestContext {
	requestId: string;
	metrics: RequestMetrics;
}

export function observeHttpHandler<TRequest extends Request>(
	config: { transport: "internal-rest"; operation: string },
	handler: (request: TRequest, context: ObservedRequestContext) => Promise<Response>
) {
	return async (request: TRequest) => {
		const requestId = resolveRequestId(request.headers);
		const metrics = new RequestMetrics();
		const startedAt = performance.now();
		let response: Response;
		try {
			response = await handler(request, { requestId, metrics });
		} catch (error) {
			console.error({
				requestId,
				...config,
				event: "request",
				requestDurationMs: Math.round(performance.now() - startedAt),
				batchSize: 1,
				outcome: "failed",
				errorCode: "unhandled-route-error",
			});
			throw error;
		}

		if (!response.ok) {
			metrics.recordFailure(
				`HTTP_${response.status}`,
				response.status >= 500 ? "failed" : "rejected"
			);
		}

		return withResponseMetrics(response, requestId, (responseBytes) => {
			console.info({
				requestId,
				...config,
				event: "request",
				requestDurationMs: Math.round(performance.now() - startedAt),
				batchSize: 1,
				responseBytes,
				...metrics.snapshot(),
			});
		});
	};
}
