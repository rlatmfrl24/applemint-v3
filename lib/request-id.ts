const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/u;

export function resolveRequestId(headers: Headers) {
	const providedRequestId = headers.get("x-request-id");
	return providedRequestId && REQUEST_ID_PATTERN.test(providedRequestId)
		? providedRequestId
		: crypto.randomUUID();
}
